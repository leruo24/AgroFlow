// End-to-end kit simulation, no hardware and no live system:
//   local Postgres (every migration) + local MQTT broker + the real AgroFlow.Api + a fake kit.
//
//   cd hardware/sim && npm install && node run-e2e.mjs
//
// It checks: the kit enrols with a one-time code and shows online; its readings are stored;
// readings it kept while offline are accepted with their own time, once, without starting
// automatic watering (and a live reading of the same value does start it, so the rule is
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
// Exit code 0 = every check passed. Needs Node 20+ and the .NET 8 SDK.
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
const apiLog = [];
const apiLogText = () => apiLog.join('');
const cleanup = async () => {
  await kit?.close();
  if (api && !api.killed) api.kill();
  mqttServer?.close();
  broker?.close();
  await db?.stop();
};

try {
  // 1. Database
  console.log('Starting a local Postgres and applying every migration...');
  db = await startDatabase();
  await applyMigrations(db.client, log);
  const q = (sql, params) => db.client.query(sql, params);

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
  await new Promise(r => mqttServer.listen(MQTT_PORT, '127.0.0.1', r));
  log(`MQTT broker on 127.0.0.1:${MQTT_PORT}`);

  // 4. The real API, pointed at both. Environment "Simulation", so no user-secrets load and no
  //    live connection string, key or token can be picked up.
  console.log('Starting AgroFlow.Api...');
  api = spawn('dotnet', ['run', '--project', path.join(repoRoot, 'backend', 'AgroFlow.Api'), '--no-launch-profile'], {
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
      Logging__LogLevel__Default: 'Warning', Logging__LogLevel__AgroFlow__Api: process.env.SIM_VERBOSE ? 'Information' : 'Warning',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', d => apiLog.push(String(d)));
  api.stderr.on('data', d => apiLog.push(String(d)));
  const apiBase = `http://127.0.0.1:${API_PORT}`;
  const up = await poll(async () => {
    try { return (await fetch(apiBase + '/api/public/ping')).ok; } catch { return false; }
  }, 180000);
  if (!up) throw new Error('the API did not start:\n' + apiLog.join('').slice(-3000));
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
  const hw = (await q("select status, enrollment_status, last_seen > now() - interval '1 minute' as recent from hardware where device_id = $1", [DEVICE_ID])).rows[0];
  check('kit shows online', hw?.status === 'Online' && hw?.enrollment_status === 'active' && hw?.recent === true, JSON.stringify(hw));

  // 7. Readings kept while offline: a dry reading from 3 hours ago, sent twice.
  const commandsBefore = (await q('select count(*)::int n from irrigation_commands where zone_id = $1', [zoneId])).rows[0].n;
  const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
  threeHoursAgo.setMilliseconds(0);
  await kit.publish('SoilMoisture', 12, threeHoursAgo);
  kit.seq--;   // the same reading again, as after a power cut mid-upload
  await kit.publish('SoilMoisture', 12, threeHoursAgo);
  await sleep(3000);
  const late = (await q('select count(*)::int n from sensor_reading where zone_id = $1 and recorded_at = $2', [zoneId, threeHoursAgo])).rows[0].n;
  check('a late reading is stored with its own time, once', late === 1, `${late} row(s) at ${threeHoursAgo.toISOString()}`);
  const commandsAfterLate = (await q('select count(*)::int n from irrigation_commands where zone_id = $1', [zoneId])).rows[0].n;
  check('a late dry reading does not start automatic watering', commandsAfterLate === commandsBefore,
    `${commandsAfterLate - commandsBefore} new command(s)`);

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
  check("a zone limited to 3 min sends maxRunSeconds 180, and the kit runs min(asked, maximum)",
    long?.maxRunSeconds === 180 && runLimitSeconds(long) === 180, long ? `asked ${long.durationSeconds}s, max ${long.maxRunSeconds}s` : 'not delivered');
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
      '--filter', 'FullyQualifiedName~SimDatabaseTests|FullyQualifiedName~DroughtCommunityDbTests|FullyQualifiedName~DroughtCommunityFixTests', '--logger', 'console;verbosity=normal'], {
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
  // The drought, community and fire scenarios, one line each.
  const passedTest = name => new RegExp(`Passed\\s+\\S*DroughtCommunityDbTests\\.${name}`).test(tests.out);
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
