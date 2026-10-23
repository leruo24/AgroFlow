// End-to-end kit simulation, no hardware and no live system:
//   local Postgres (every migration) + local MQTT broker + the real AgroFlow.Api + a fake kit.
//
//   cd hardware/sim && npm install && node run-e2e.mjs
//
// It checks: the kit enrols with a one-time code and shows online; its readings are stored;
// a simulated 10-minute broker outage buffers readings, then uploads them oldest first
// with their measured times and no duplicates, without starting automatic watering from
// an old dry reading (a live reading of the same value does start it, so the age rule is
// what stops it); a Manual zone is never watered automatically and its kit is told not to
// water offline; a manual 1-minute command reaches it with the zone's maximum run time, is
// acknowledged, and its run report marks it finished in the history; a zone limited to
// 3 minutes sends a 3-minute limit; the lost-connection failsafe stops a run when MQTT goes
// (3 s here, 3 min on the board); a kept pump run uploaded twice is counted once. Then the
// API-side database tests run against the same Postgres (SimDatabaseTests: no kit / kit
// offline / over the maximum refused, sent -> started -> finished, staff and Telegram,
// weather in the app), and the drought, community and fire scenarios (DroughtCommunityDbTests),
// each reported as its own line here. Before that: the 0056 demo farms near Mahikeng are
// seeded as expected, and the drought check that runs when the API starts went through every
// farm without an error.
// Audit fixes (2026-10-23): every path is capped at the zone maximum (scheduled and automatic
// commands asking for an hour arrive as 5 min); a broker restart (a command made meanwhile waits
// unsent, then arrives when the API has reconnected by itself); an API restart (a command saved
// while it was down is sent when it is back). Double-tapped Irrigate, "No response" with no
// acknowledgement and the capped message use the farmer's sign-in, so they run in-process
// (SimDatabaseTests) against this same database and are reported as their own lines.
// These are software checks with a pretend pump: they say nothing about the physical kit.
// Exit code 0 = every check passed. Needs Node 20+ and the .NET 8 SDK.
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import Aedes from 'aedes';
import { startDatabase, applyMigrations, repoRoot } from './db.mjs';
import { FakeKit, runLimitSeconds } from './fake-kit.mjs';

const API_PORT = 5099;
const MQTT_PORT = 18830;
const MQTT_USER = 'agroflow-sim';
const MQTT_PASS = 'sim-only-password';
const DEVICE_ID = 'SIMKIT00A1B2';
const ENROLLMENT_CODE = 'SIM12345';

const results = [];
const log = (...a) => console.log('  ', ...a);
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, timeoutMs = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(300);
  }
  return last;
}

let db, broker, mqttServer, api, kit;
const apiBase = `http://127.0.0.1:${API_PORT}`;
const apiLog = [];
const apiLogText = () => apiLog.join('');
// The broker and the API are started by these, so the run can restart them (sections 9c, 9d).
const mqttSockets = new Set();
async function startBroker() {
  broker = await Aedes.createBroker
    ? await Aedes.createBroker({ authenticate: (_c, u, p, cb) => cb(null, u === MQTT_USER && String(p) === MQTT_PASS) })
    : Aedes({ authenticate: (_c, u, p, cb) => cb(null, u === MQTT_USER && String(p) === MQTT_PASS) });
  if (process.env.SIM_VERBOSE) {
    broker.on('clientError', (c, e) => console.log('   broker: client error', c?.id, e.message));
    broker.on('connectionError', (c, e) => console.log('   broker: connection error', c?.id, e.message));
    broker.on('client', c => console.log('   broker: connected', c.id));
    broker.on('clientDisconnect', c => console.log('   broker: disconnected', c.id));
  }
  mqttServer = net.createServer(broker.handle);
  mqttServer.on('connection', socket => { mqttSockets.add(socket); socket.on('close', () => mqttSockets.delete(socket)); });
  await new Promise(r => mqttServer.listen(MQTT_PORT, '127.0.0.1', r));
}
async function stopBroker() {
  // Safe to call twice (a test section, then cleanup): it stops what is running, if anything.
  const closingBroker = broker, closingServer = mqttServer;
  broker = null; mqttServer = null;
  for (const socket of mqttSockets) socket.destroy();
  if (closingServer) await new Promise(r => closingServer.close(() => r()));
  if (closingBroker) await new Promise(r => closingBroker.close(() => r()));
}
async function startApi(extraArgs = []) {
  api = spawn('dotnet', ['run', '--project', path.join(repoRoot, 'backend', 'AgroFlow.Api'), '--no-launch-profile', ...extraArgs], {
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Simulation',
      ASPNETCORE_URLS: `http://127.0.0.1:${API_PORT}`,
      ConnectionStrings__Supabase: db.connectionString,
      ApiKey: 'sim-only-device-key',
      Supabase__Url: 'http://127.0.0.1:9',
      Supabase__JwksUrl: 'https://127.0.0.1:9/auth/v1/.well-known/jwks.json',
      Supabase__ServiceRoleKey: 'none',
      Mqtt__Host: '127.0.0.1', Mqtt__Port: String(MQTT_PORT), Mqtt__UseTls: 'false',
      Mqtt__Username: MQTT_USER, Mqtt__Password: MQTT_PASS, Mqtt__ProtocolVersion: '311',
      Telegram__BotToken: '', Telegram__EnablePolling: 'false',
      WeatherAlerts__Enabled: 'false', Simulation__Enabled: 'false', FaultChecks__Enabled: 'false',
      DeviceMonitor__Enabled: 'false',
      // The API resends an unacknowledged command on this sweep (120 s by default); 5 s keeps
      // the lost-acknowledgement case (9e) short.
      Irrigation__ReplaySweepIntervalSeconds: '5',
      Logging__LogLevel__Default: 'Warning', Logging__LogLevel__AgroFlow__Api: process.env.SIM_VERBOSE ? 'Information' : 'Warning',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', d => apiLog.push(String(d)));
  api.stderr.on('data', d => apiLog.push(String(d)));
  const up = await poll(async () => {
    try { return (await fetch(apiBase + '/api/public/ping')).ok; } catch { return false; }
  }, 180000);
  if (!up) throw new Error('the API did not start:\n' + apiLog.join('').slice(-3000));
}
async function stopApi() {
  const exited = new Promise(r => api.once('exit', r));
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  else api.kill();
  await exited;
  await poll(async () => { try { await fetch(apiBase + '/api/public/ping'); return false; } catch { return true; } }, 20000);
}

const cleanup = async () => {
  await kit?.close();
  if (api && api.exitCode === null) await stopApi().catch(() => {});
  await stopBroker();
  await db?.stop();
};

try {
  // 1. Database
  console.log('Starting a local Postgres and applying every migration...');
  db = await startDatabase();
  await applyMigrations(db.client, log);
  const q = (sql, params) => db.client.query(sql, params);
  const dedupeMigration = await readFile(
    path.join(repoRoot, 'supabase', 'migrations', '0060_sensor_reading_device_dedupe.sql'), 'utf8');
  await q(dedupeMigration);
  await q(dedupeMigration);
  const dedupeSchema = (await q(`select
    exists(select 1 from information_schema.columns where table_name = 'sensor_reading' and column_name = 'hardware_id') as has_column,
    to_regclass('public.uq_sensor_reading_hardware_measured') is not null as has_index,
    exists(select 1 from information_schema.columns where table_name = 'hardware' and column_name = 'offline_backlog') as has_backlog`)).rows[0];
  check('migration 0060 is safe to apply twice', dedupeSchema.has_column && dedupeSchema.has_index && dedupeSchema.has_backlog);

  // 2. What an admin does in the console: farmer, farm, zone (automatic), kit + one-time code.
  //    (The admin endpoints need a Supabase login; their database effect is written here.)
  const farmer = (await q(
    "insert into auth.users (email, raw_user_meta_data) values ('sim-farmer@example.org', '{\"name\":\"Sim Farmer\"}') returning id")).rows[0].id;
  await q("insert into profile (id, name, email, role) values ($1, 'Sim Farmer', 'sim-farmer@example.org', 'farm_user') on conflict (id) do nothing", [farmer]);
  const farmId = (await q(
    "insert into farm (owner_id, name, location) values ($1, 'Simulation Farm', 'Nowhere') returning farm_id", [farmer])).rows[0].farm_id;
  const zoneId = (await q(
    `insert into zone (farm_id, name, crop_type, irrigation_mode, moisture_threshold, desired_moisture, flow_rate_lpm)
     values ($1, 'Sim bed', 'spinach', 'automatic', 30, 60, 1.5) returning id`, [farmId])).rows[0].id;
  await q(
    `insert into hardware (device_name, device_type, zone_id, enrollment_status, enrollment_code, enrollment_code_expires_at)
     values ('Sim kit', 'ESP32', $1, 'enrolled', $2, now() + interval '1 hour')`, [zoneId, ENROLLMENT_CODE]);
  log(`seeded farmer, farm ${farmId}, zone ${zoneId} (automatic), kit with a one-time code`);

  // 3. MQTT broker (stands in for HiveMQ), with a login like the real one.
  await startBroker();
  log(`MQTT broker on 127.0.0.1:${MQTT_PORT}`);

  // 4. The real API, pointed at both. Environment "Simulation", so no user-secrets load and no
  //    live connection string, key or token can be picked up.
  console.log('Starting AgroFlow.Api...');
  await startApi();
  log('API up');
  await sleep(2500);   // MQTT subscription and LISTEN start just after the web server

  // 5. The kit: enrol with the one-time code, get its MQTT login, connect.
  kit = new FakeKit({ apiBase, mqttUrl: `mqtt://127.0.0.1:${MQTT_PORT}`, deviceId: DEVICE_ID, log });
  const claim = await kit.claim(ENROLLMENT_CODE);
  check('kit enrols with the one-time code', claim.zoneId === Number(zoneId) && claim.farmId === Number(farmId) && !!claim.deviceToken);
  const reuse = await new FakeKit({ apiBase, mqttUrl: '', deviceId: 'OTHERKIT0001' }).http('POST', '/api/devices/claim',
    { deviceId: 'OTHERKIT0001', enrollmentCode: ENROLLMENT_CODE }, false);
  check('the code works once only', reuse.status === 401, `second claim -> ${reuse.status}`);
  await kit.connectMqtt();

  // 6. Live readings every couple of seconds.
  for (let i = 0; i < 3; i++) {
    await kit.publishReadings({ soil: 55 + i, temperature: 21.5, humidity: 58 });
    await sleep(2000);
  }
  const stored = await poll(async () => {
    const r = (await q('select sensor_type, count(*)::int n from sensor_reading where zone_id = $1 group by sensor_type', [zoneId])).rows;
    const by = Object.fromEntries(r.map(x => [x.sensor_type, x.n]));
    return by.SoilMoisture >= 3 && by.Temperature >= 3 && by.Humidity >= 3 ? by : null;
  });
  check('live readings are stored', !!stored, JSON.stringify(stored));
  const hw = (await q("select hardware_id, status, enrollment_status, last_seen > now() - interval '1 minute' as recent from hardware where device_id = $1", [DEVICE_ID])).rows[0];
  check('kit shows online', hw?.status === 'Online' && hw?.enrollment_status === 'active' && hw?.recent === true, JSON.stringify(hw));

  // 7. The broker drops for a logical 10 minutes. Like the firmware, the fake kit keeps
  //    every 30-second three-sensor sample with its measured time, then replays oldest first.
  const startsBefore = (await q("select count(*)::int n from irrigation_commands where zone_id = $1 and command = 'start'", [zoneId])).rows[0].n;
  await stopBroker();
  const disconnected = await poll(() => !kit.connected, 5000);
  const outageEnd = new Date(Date.now() - 30_000);
  outageEnd.setMilliseconds(0);
  const outageStart = new Date(outageEnd.getTime() - 10 * 60 * 1000);
  const backlog = [];
  for (let sample = 1; sample <= 20; sample++) {
    const measuredAt = new Date(outageStart.getTime() + sample * 30_000);
    backlog.push(
      { sensorType: 'SoilMoisture', value: sample === 1 ? 12 : 65, measuredAt },
      { sensorType: 'Temperature', value: 20.5 + sample / 100, measuredAt },
      { sensorType: 'Humidity', value: 60, measuredAt },
    );
  }
  const storedWhileDown = (await q(
    'select count(*)::int n from sensor_reading where hardware_id = $1 and recorded_at > $2 and recorded_at <= $3',
    [hw.hardware_id, outageStart, outageEnd])).rows[0].n;
  check('a 10-minute broker drop buffers every 30-second three-sensor sample',
    disconnected && backlog.length === 60 && storedWhileDown === 0,
    `${backlog.length} buffered, ${storedWhileDown} reached the database while down`);

  await startBroker();
  const apiReconnected = await poll(
    () => Object.keys(broker?.clients ?? {}).some(id => id.startsWith('agroflow-api-')), 25000);
  await kit.connectMqtt();
  let backlogMidway = null;
  for (let i = 0; i < backlog.length; i++) {
    const reading = backlog[i];
    // "backlog": the readings still waiting after this one (firmware 1.7.0).
    await kit.publish(reading.sensorType, reading.value, reading.measuredAt, { backlog: backlog.length - i - 1 });
    if (i === 0) {
      kit.seq--; // retry the oldest entry, as after power loss between publish and flash save
      await kit.publish(reading.sensorType, reading.value, reading.measuredAt, { backlog: backlog.length - 1 });
    }
    if (i === 29) {
      backlogMidway = await poll(async () =>
        (await q('select offline_backlog from hardware where hardware_id = $1', [hw.hardware_id])).rows[0]?.offline_backlog === 30, 10000);
    }
  }
  await poll(async () => {
    const count = (await q(
      'select count(*)::int n from sensor_reading where hardware_id = $1 and recorded_at > $2 and recorded_at <= $3',
      [hw.hardware_id, outageStart, outageEnd])).rows[0].n;
    return count >= backlog.length;
  });
  await sleep(1000); // let a duplicate handler finish before asserting the final count
  const replayed = (await q(
    `select id, hardware_id, sensor_type, recorded_at
       from sensor_reading
      where hardware_id = $1 and recorded_at > $2 and recorded_at <= $3
      order by id`, [hw.hardware_id, outageStart, outageEnd])).rows;
  const replayKeys = new Set(replayed.map(r => `${r.sensor_type}|${new Date(r.recorded_at).toISOString()}`));
  const replayInOrder = replayed.every((r, i) => i === 0 ||
    new Date(replayed[i - 1].recorded_at).getTime() <= new Date(r.recorded_at).getTime());
  check('after reconnect the backlog is stored once each, oldest first, with measured times',
    apiReconnected && replayed.length === backlog.length && replayKeys.size === backlog.length && replayInOrder &&
      replayed.every(r => String(r.hardware_id) === String(hw.hardware_id)),
    `${replayed.length} rows, ${replayKeys.size} unique keys, ordered ${replayInOrder}`);
  const backlogDone = (await q('select offline_backlog, offline_backlog_at is not null as reported from hardware where hardware_id = $1', [hw.hardware_id])).rows[0];
  check("the backlog count shows in the kit's status: 30 halfway through the upload, 0 when it is done",
    !!backlogMidway && backlogDone?.offline_backlog === 0 && backlogDone?.reported === true, JSON.stringify(backlogDone));
  const startsAfterBacklog = (await q("select count(*)::int n from irrigation_commands where zone_id = $1 and command = 'start'", [zoneId])).rows[0].n;
  check('the old dry reading from the backlog does not start automatic watering', startsAfterBacklog === startsBefore,
    `${startsAfterBacklog - startsBefore} new start command(s)`);

  // Control: the same dry value as a live reading does start it, so the rule above is what stopped it.
  await kit.publish('SoilMoisture', 12);
  const auto = await kit.waitForCommand(c => c.command === 'start' && c.source === 'auto').catch(() => null);
  check('control: a live dry reading does start automatic watering', !!auto);
  if (auto) await kit.ack(auto.id);
  await kit.publish('SoilMoisture', 65);   // wet again: the server sends 'stop'
  const autoStop = await kit.waitForCommand(c => c.command === 'stop' && c.source === 'auto').catch(() => null);
  if (autoStop) await kit.ack(autoStop.id);

  // 7b. A Manual zone is never watered automatically, and its kit is told so for offline.
  await q("update zone set irrigation_mode = 'manual' where id = $1", [zoneId]);
  const beforeManual = (await q('select count(*)::int n from irrigation_commands where zone_id = $1', [zoneId])).rows[0].n;
  await kit.publish('SoilMoisture', 10);   // bone dry, live
  await sleep(3000);
  const afterManual = (await q('select count(*)::int n from irrigation_commands where zone_id = $1', [zoneId])).rows[0].n;
  check('a Manual zone gets no automatic command from a bone-dry live reading', afterManual === beforeManual,
    `${afterManual - beforeManual} new command(s)`);
  const cfgManual = await kit.http('GET', '/api/devices/config');
  check("a Manual zone's kit is told not to water by itself offline",
    cfgManual.status === 200 && cfgManual.body?.autoWateringAllowed === false, JSON.stringify(cfgManual.body));
  await q("update zone set irrigation_mode = 'automatic' where id = $1", [zoneId]);
  const cfgAuto = await kit.http('GET', '/api/devices/config');
  check('...and an Automatic one is allowed', cfgAuto.body?.autoWateringAllowed === true, JSON.stringify(cfgAuto.body));
  await kit.publish('SoilMoisture', 65);   // wet again before the manual runs

  // 8. A manual 1-minute run, as the farmer's Water now creates it.
  const manualId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 60) returning id", [zoneId])).rows[0].id;
  const manual = await kit.waitForCommand(c => String(c.id) === String(manualId)).catch(() => null);
  check('the manual 1-minute command reaches the kit', manual?.command === 'start' && manual?.durationSeconds === 60,
    manual ? `${manual.command} ${manual.durationSeconds}s` : 'not delivered');
  check("the command carries the zone's maximum run time (default 5 min)", manual?.maxRunSeconds === 300,
    `maxRunSeconds ${manual?.maxRunSeconds}`);
  const ack = manual ? await kit.ack(manual.id) : { status: 0 };
  const executed = (await q('select status from irrigation_commands where id = $1', [manualId])).rows[0]?.status;
  check('the kit acknowledges it', ack.status === 200 && executed === 'executed', `ACK ${ack.status}, status ${executed}`);
  const startedAt = manual?.receivedAt ?? new Date();
  startedAt.setMilliseconds(0);
  const run = await kit.reportRun({ runtimeSeconds: 60, triggerSource: 'manual', startedAt });
  const event = (await q("select runtime_seconds, trigger_source, sync_status, estimated_litres from irrigation_event where zone_id = $1 and trigger_source = 'manual'", [zoneId])).rows;
  check('the run is logged as an irrigation event', run.status === 200 && event.length === 1 && event[0].runtime_seconds === 60,
    JSON.stringify(event[0] ?? run.body));
  const finished = (await q('select status, finished_at is not null as finished from irrigation_commands where id = $1', [manualId])).rows[0];
  const linked = (await q('select count(*)::int n from irrigation_event where command_id = $1', [manualId])).rows[0].n;
  check('the run report marks the command finished, and the history links the two',
    finished?.status === 'executed' && finished?.finished === true && linked === 1, JSON.stringify({ ...finished, linked }));

  // 8b. A zone limited to 3 minutes: a longer command row (the API refuses it from the app;
  //     a schedule could still ask) reaches the kit with a 3-minute limit, which the kit keeps.
  await q('update zone set max_run_minutes = 3 where id = $1', [zoneId]);
  const longId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'scheduled', 600) returning id", [zoneId])).rows[0].id;
  const long = await kit.waitForCommand(c => String(c.id) === String(longId)).catch(() => null);
  check("a zone limited to 3 min: a 10-min scheduled command arrives as 3 min (capped in the database), maxRunSeconds 180",
    long?.durationSeconds === 180 && long?.maxRunSeconds === 180 && runLimitSeconds(long) === 180,
    long ? `arrived ${long.durationSeconds}s, max ${long.maxRunSeconds}s` : 'not delivered');
  if (long) {
    await kit.ack(long.id);
    await kit.reportRun({ runtimeSeconds: 180, triggerSource: 'scheduled', startedAt: (() => { const d = new Date(); d.setMilliseconds(0); return d; })() });
  }
  await q('update zone set max_run_minutes = 5 where id = $1', [zoneId]);

  // 8c. Lost-connection failsafe: MQTT goes during a server run; the kit stops by itself and
  //     reports the run when it is back (3 s here; LOST_CONTACT_STOP_MS is 3 min on the board).
  const failId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 120) returning id", [zoneId])).rows[0].id;
  const failCmd = await kit.waitForCommand(c => String(c.id) === String(failId)).catch(() => null);
  if (failCmd) {
    await kit.ack(failCmd.id);
    const running = kit.startRun(failCmd, { lostContactMs: 3000 });
    await sleep(500);
    await kit.disconnectMqtt();
    const stopped = await running;
    await kit.connectMqtt();
    const failRun = await kit.reportRun({ runtimeSeconds: stopped.runtimeSeconds, triggerSource: 'manual', startedAt: stopped.startedAt });
    const failRow = (await q('select finished_at is not null as finished from irrigation_commands where id = $1', [failId])).rows[0];
    check('the lost-connection failsafe stops a 2-minute run once MQTT has been gone 3 s, and the run is still reported',
      stopped.reason === 'lost contact' && stopped.runtimeSeconds >= 3 && stopped.runtimeSeconds < 10 && failRun.status === 200 && failRow?.finished === true,
      `${stopped.reason} after ${stopped.runtimeSeconds}s; finished ${failRow?.finished}`);
  } else {
    check('the lost-connection failsafe stops a run', false, 'command not delivered');
  }

  // 9. A pump run kept while offline (local page), uploaded twice.
  const keptStart = new Date(Date.now() - 2 * 3600 * 1000);
  keptStart.setMilliseconds(0);
  const r1 = await kit.reportRun({ runtimeSeconds: 120, triggerSource: 'manual', startedAt: keptStart, syncStatus: 'offline_queued' });
  const r2 = await kit.reportRun({ runtimeSeconds: 120, triggerSource: 'manual', startedAt: keptStart, syncStatus: 'offline_queued' });
  const kept = (await q("select count(*)::int n from irrigation_event where zone_id = $1 and sync_status = 'offline_queued'", [zoneId])).rows[0].n;
  check('a kept pump run uploaded twice is counted once', r1.status === 200 && r2.status === 200 && kept === 1, `${kept} row(s)`);

  // 9a. The cap on every path the kit sees (AF-05). Automatic watering's own command (section 7)
  //     and a scheduled and an automatic one asking for an hour all arrive at the zone's maximum.
  // (An automatic start has no length of its own: it runs until the server's stop, at most maxRunSeconds.)
  check('the automatic command from section 7 runs at most the zone maximum (5 min)',
    !!auto && auto.maxRunSeconds === 300 && runLimitSeconds(auto) <= 300,
    auto ? `asked ${auto.durationSeconds ?? 'until stopped'}, the kit stops by ${runLimitSeconds(auto)}s` : 'none');
  const nowWhole = () => { const d = new Date(); d.setMilliseconds(0); return d; };
  for (const source of ['scheduled', 'auto']) {
    const id = (await q(
      "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', $2, 3600) returning id", [zoneId, source])).rows[0].id;
    const got = await kit.waitForCommand(c => String(c.id) === String(id)).catch(() => null);
    const row = (await q('select duration_seconds, requested_duration_seconds from irrigation_commands where id = $1', [id])).rows[0];
    check(`a ${source} command asking for 60 min arrives as 5 min (the zone maximum); the hour asked is kept for the record`,
      got?.durationSeconds === 300 && row?.duration_seconds === 300 && row?.requested_duration_seconds === 3600,
      got ? `arrived ${got.durationSeconds}s; row ${JSON.stringify(row)}` : 'not delivered');
    if (got) {
      await kit.ack(got.id);
      await kit.reportRun({ runtimeSeconds: 300, triggerSource: source, startedAt: nowWhole() });
    }
  }

  // 9c. Broker restart. The API notices, a command made meanwhile waits (it is not marked as
  //     sent), and when the broker is back the API reconnects by itself and the command arrives.
  //     (The board reconnects by itself; the simulated kit is told to.)
  console.log('Restarting the MQTT broker...');
  await stopBroker();
  const restartNoticed = await poll(async () => /MQTT disconnected/.test(apiLogText()), 20000);
  const whileDownId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 60) returning id", [zoneId])).rows[0].id;
  await sleep(3000);
  const whileDown = (await q('select status, published_at from irrigation_commands where id = $1', [whileDownId])).rows[0];
  check('broker down: the API notices, and a command made meanwhile waits unsent (no "Waiting for kit")',
    !!restartNoticed && whileDown?.status === 'pending' && whileDown?.published_at === null, JSON.stringify({ restartNoticed: !!restartNoticed, ...whileDown }));
  await startBroker();
  await poll(async () => { try { await kit.connectMqtt(); return true; } catch { return false; } }, 20000);
  const restartReplayed = await kit.waitForCommand(c => String(c.id) === String(whileDownId), 45000).catch(() => null);
  const restartDeliveries = kit.commands.filter(c => String(c.id) === String(whileDownId)).length;
  check('broker back: the API reconnects by itself and the waiting command reaches the kit',
    !!restartReplayed, restartReplayed ? `delivered ${restartDeliveries} time(s)` : 'not delivered within 45 s');
  if (restartReplayed) {
    await kit.ack(restartReplayed.id);
    await kit.reportRun({ runtimeSeconds: 60, triggerSource: 'manual', startedAt: nowWhole() });
  }
  const afterBrokerId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 30) returning id", [zoneId])).rows[0].id;
  const afterBroker = await kit.waitForCommand(c => String(c.id) === String(afterBrokerId)).catch(() => null);
  check('...and a new command after the restart arrives as normal', !!afterBroker);
  if (afterBroker) {
    await kit.ack(afterBroker.id);
    await kit.reportRun({ runtimeSeconds: 30, triggerSource: 'manual', startedAt: nowWhole() });
  }

  // 9d. API restart. A command saved while the API is down (as the scheduler in the database
  //     does) is sent when it is back; the kit's readings and login keep working.
  console.log('Restarting AgroFlow.Api...');
  await stopApi();
  const apiDownId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'scheduled', 45) returning id", [zoneId])).rows[0].id;
  await startApi(['--no-build']);
  const sentAfter = await kit.waitForCommand(c => String(c.id) === String(apiDownId), 45000).catch(() => null);
  check('API restart: a command saved while it was down reaches the kit once it is back', !!sentAfter,
    sentAfter ? `${sentAfter.durationSeconds}s` : 'not delivered within 45 s');
  if (sentAfter) {
    await kit.ack(sentAfter.id);
    await kit.reportRun({ runtimeSeconds: 45, triggerSource: 'scheduled', startedAt: nowWhole() });
  }
  const readingsBefore = (await q('select count(*)::int n from sensor_reading where zone_id = $1', [zoneId])).rows[0].n;
  await kit.publish('SoilMoisture', 63);
  const readingAfter = await poll(async () =>
    (await q('select count(*)::int n from sensor_reading where zone_id = $1', [zoneId])).rows[0].n > readingsBefore, 15000);
  const cfgAfter = await kit.http('GET', '/api/devices/config');
  check("...and the kit's readings and its login still work after the restart", !!readingAfter && cfgAfter.status === 200,
    `reading stored ${!!readingAfter}, config ${cfgAfter.status}`);


  // 9e. A lost acknowledgement (firmware 1.7.0, CommandIds.h). The kit waters, but its
  //     acknowledgement never reaches the API, so the API resends the command (its replay
  //     sweep, every 5 s here). The kit knows the ID: it acknowledges again with the first
  //     time and does not water again. A reboot (the same flash, a new kit object) still knows it.
  const lostAckId = (await q(
    "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 30) returning id", [zoneId])).rows[0].id;
  const firstDelivery = await kit.waitForCommand(c => String(c.id) === String(lostAckId)).catch(() => null);
  const firstRun = firstDelivery ? await kit.carryOut(firstDelivery, { loseAck: true }) : null;
  const pendingAfterLoss = (await q('select status from irrigation_commands where id = $1', [lostAckId])).rows[0]?.status;
  const resent = await poll(() => kit.commands.filter(c => String(c.id) === String(lostAckId)).length >= 2, 30000);
  const secondDelivery = kit.commands.filter(c => String(c.id) === String(lostAckId))[1];
  const repeat = secondDelivery ? await kit.carryOut(secondDelivery) : null;
  const acked = await poll(async () => {
    const r = (await q('select status, executed_at from irrigation_commands where id = $1', [lostAckId])).rows[0];
    return r?.status === 'executed' ? r : null;
  }, 15000);
  const runsForCommand = kit.runs.filter(r => String(r.id) === String(lostAckId)).length;
  const sameTime = acked && firstRun?.ackedAt && Math.abs(new Date(acked.executed_at).getTime() - firstRun.ackedAt.getTime()) < 2000;
  check('acknowledgement lost, the API resends: the kit waters once, and its repeated acknowledgement keeps the first time',
    !!firstRun && firstRun.repeated === false && pendingAfterLoss === 'pending' && !!resent && repeat?.repeated === true &&
      runsForCommand === 1 && !!sameTime,
    `${kit.commands.filter(c => String(c.id) === String(lostAckId)).length} deliveries, ${runsForCommand} run(s), status ${acked?.status ?? pendingAfterLoss}`);
  const rebooted = new FakeKit({ apiBase, mqttUrl: '', deviceId: DEVICE_ID, log, flash: kit.flash });
  Object.assign(rebooted, { token: kit.token, zoneId: kit.zoneId, farmId: kit.farmId });
  const afterReboot = firstDelivery ? await rebooted.carryOut(firstDelivery) : null;
  check('...and after a reboot (the IDs are kept in flash) the same command is still not carried out again',
    afterReboot?.repeated === true && rebooted.runs.length === 0);
  if (firstRun) await kit.reportRun({ runtimeSeconds: 30, triggerSource: 'manual', startedAt: (() => { const d = new Date(firstRun.ackedAt); d.setMilliseconds(0); return d; })() });

  // 9b. Drought mode and community alerts: the demo farms (0056) and the start-up drought check.
  const demo = (await q(`select f.name, f.latitude, f.longitude, f.sim_scenario, f.water_source,
      (select count(*)::int from zone z where z.farm_id = f.farm_id) zones
      from farm f where f.name in ('Mahikeng (Simulated)', 'Ottoshoop (Simulated)') order by f.name`)).rows;
  const mahikeng = demo.find(f => f.name === 'Mahikeng (Simulated)');
  const ottoshoop = demo.find(f => f.name === 'Ottoshoop (Simulated)');
  check('the demo drought farm near Mahikeng is seeded: tank, 3 zones, drought scenario',
    mahikeng?.sim_scenario === 'drought' && mahikeng?.water_source === 'tank' && mahikeng?.zones === 3, JSON.stringify(mahikeng));
  // Haversine, as CommunityRules.DistanceKm: Ottoshoop is the neighbour inside the community radius.
  const km = (a, b) => {
    const r = x => Number(x) * Math.PI / 180;
    const h = Math.sin((r(b.latitude) - r(a.latitude)) / 2) ** 2 +
      Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin((r(b.longitude) - r(a.longitude)) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  const apart = mahikeng && ottoshoop ? km(mahikeng, ottoshoop) : NaN;
  check('the second demo farm (Ottoshoop) is within the 50 km pest and fire radius of Mahikeng',
    apart > 20 && apart < 50, `${apart.toFixed(1)} km apart`);
  await sleep(1500);
  check('the drought check that runs at start-up went through every farm without an error',
    !/Drought check failed/.test(apiLogText()), /Drought check failed/.test(apiLogText()) ? 'see the API log' : '');

  // 10. The API's own routes against this database (farmer and admin routes need a login the
  //     simulation cannot make, so they run in-process with the test sign-in):
  //     backend/AgroFlow.Domain.Tests/SimDatabaseTests.cs.
  console.log('Running the API database tests against this Postgres...');
  const tests = await new Promise(resolve => {
    const p = spawn('dotnet', ['test', path.join(repoRoot, 'backend', 'AgroFlow.Domain.Tests'),
      '--filter', 'FullyQualifiedName~SimDatabaseTests|FullyQualifiedName~DbTests|FullyQualifiedName~DroughtCommunityFixTests', '--logger', 'console;verbosity=normal'], {
      env: { ...process.env, AGROFLOW_SIM_DB: db.connectionString }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
  // "Total tests: 8 / Passed: 8 [/ Failed: n] [/ Skipped: n]" (console logger, normal verbosity).
  const count = re => Number((tests.out.match(re) ?? [])[1] ?? 0);
  const total = count(/Total tests:\s+(\d+)/), passed = count(/^\s*Passed:\s+(\d+)/m);
  const failedN = count(/^\s*Failed:\s+(\d+)/m), skippedN = count(/^\s*Skipped:\s+(\d+)/m);
  check('the API database tests pass (no kit, kit offline, over the maximum, sent/started/finished, staff + Telegram, weather in the app)',
    tests.code === 0 && total >= 8 && passed === total && failedN === 0 && skippedN === 0,
    `${passed} of ${total} passed, ${failedN} failed, ${skippedN} skipped`);
  if (tests.code !== 0) console.log(tests.out.split('\n').filter(l => /Failed |Assert|Error Message|expected|actual/i.test(l)).slice(0, 30).join('\n'));
  const passedIn = (cls, name) => new RegExp(`Passed\\s+\\S*${cls}\\.${name}`).test(tests.out);
  // The farmer's own routes (Irrigate, command status, schedules), in-process with the test sign-in.
  check('double-tapped Irrigate: one command; a second press and two at the same instant get that same one back',
    passedIn('SimDatabaseTests', 'A_run_above_the_zones_maximum_is_capped_and_a_double_tap_is_one_run'));
  check('no acknowledgement: the app reads "Waiting for kit", then "No response" after 60 s',
    passedIn('SimDatabaseTests', 'With_no_acknowledgement_Irrigate_reads_No_response_after_the_wait'));
  check("cap from the app: \"Capped to 3 min (this zone's limit)\"; a saved 20-min schedule shows 3 min; every insert path capped",
    passedIn('SimDatabaseTests', 'A_run_above_the_zones_maximum_is_capped_and_a_double_tap_is_one_run') &&
    passedIn('SimDatabaseTests', 'Every_insert_path_is_capped_by_the_database_too'));
  // The drought, community and fire scenarios, one line each.
  const passedTest = name => passedIn('DroughtCommunityDbTests', name);
  check('scenario, drought: a low tank and a dry forecast turn drought mode on, with the water budget and zone priorities; by hand too',
    passedTest('Drought_mode_turns_on_from_the_farms_own_data_with_a_budget_and_zone_priorities_and_by_hand'));
  check('scenario, community: 2 reports per 36 hours (confirming does not count); nearby farms told by distance only, never the reporter',
    passedTest('Two_reports_per_36_hours_the_third_is_refused_and_confirming_does_not_count') &&
    passedTest('Nearby_opted_in_farms_are_told_with_distance_only_and_never_the_reporter'));
  check('scenario, fire: downwind farms first, wider radius at 3 confirmations, "out" closes it',
    passedTest('A_fire_marks_downwind_farms_escalates_at_three_confirmations_and_out_closes_it'));
  check('scenario, moderation: staff hide a report with a reason and it stops notifying; reports expire',
    passedTest('Staff_hide_a_report_with_a_reason_it_stops_notifying_and_reports_expire'));
} catch (error) {
  check('simulation ran to the end', false, error.message);
} finally {
  if (process.env.SIM_VERBOSE) console.log(apiLogText().slice(-6000));
  await cleanup();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
