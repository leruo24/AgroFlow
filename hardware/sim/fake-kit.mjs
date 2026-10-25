// A pretend AgroFlow irrigation kit (firmware 1.7.1's contract) for the simulation. It talks
// to the real AgroFlow.Api exactly as the ESP32 sketch does:
//   POST /api/devices/claim                    one-time enrollment code -> device token
//   GET  /api/devices/mqtt-credentials         X-Device-Token -> MQTT login
//   MQTT agroflow/farm/{farm}/device/{id}/sensors   {"sensorType","value"[,"recordedAt","seq"],"backlog"}
//   MQTT agroflow/farm/{farm}/device/{id}/commands  {"id","command","durationSeconds","source","maxRunSeconds"}
//   POST /api/devices/commands/{id}/executed   ACK
//   POST /api/irrigation-events                a finished pump run
// The pump is pretend: a run is reported with the commanded duration straight away, so a
// "1-minute run" does not make the test wait a minute. startRun() runs the pump for real time
// with firmware 1.7.0's two stops (RunLimits.h): min(asked, maxRunSeconds, 120 min), and the
// lost-connection failsafe, whose 3 minutes the simulation shortens (lostContactMs).
// carryOut() applies firmware 1.7.0's "a command runs once" rule (CommandIds.h): a repeated
// command ID is acknowledged again with its first time and never carried out again. The IDs
// live in `flash`, which a test can hand to a new FakeKit to stand in for a reboot.
import mqtt from 'mqtt';

export const RECENT_COMMAND_IDS = 32;

export const DEFAULT_MAX_RUN_SECONDS = 5 * 60;
export const ABSOLUTE_MAX_RUN_SECONDS = 120 * 60;

// The same rule as the firmware's agroflow::effectiveRunMs, in seconds.
export function runLimitSeconds(command) {
  const asked = Number(command.durationSeconds) > 0 ? Number(command.durationSeconds) : 0;
  let max = Number(command.maxRunSeconds) > 0 ? Number(command.maxRunSeconds) : DEFAULT_MAX_RUN_SECONDS;
  if (max > ABSOLUTE_MAX_RUN_SECONDS) max = ABSOLUTE_MAX_RUN_SECONDS;
  return asked === 0 || asked > max ? max : asked;
}

export class FakeKit {
  // firmwareVersion '1.7.2' behaves like the 1.7.2 sketch: it keeps the MQTT login and topics the
  // claim answered with, uses agroflow/<deviceId>/telemetry|cmd|ack|status, leaves a retained
  // "offline" last will, announces itself online, and acknowledges commands over MQTT.
  constructor({ apiBase, mqttUrl, deviceId, firmwareVersion = '1.7.1', log = () => {}, flash = { commandIds: [] } }) {
    Object.assign(this, { apiBase, mqttUrl, deviceId, firmwareVersion, log, flash });
    this.kitTopics = firmwareVersion >= '1.7.2';
    this.commands = [];
    this.seq = 1;
    this.runs = [];   // every start command the kit actually carried out
    this.stops = [];  // every stop command the kit actually carried out
    this.pumpRunning = false;
  }

  async http(method, path, body, withToken = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (withToken && this.token) headers['X-Device-Token'] = this.token;
    const res = await fetch(this.apiBase + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  async claim(enrollmentCode) {
    const res = await this.http('POST', '/api/devices/claim',
      { deviceId: this.deviceId, enrollmentCode, firmwareVersion: this.firmwareVersion }, false);
    if (res.status !== 200) throw new Error(`claim refused: ${res.status} ${JSON.stringify(res.body)}`);
    this.token = res.body.deviceToken;
    this.zoneId = res.body.zoneId;
    this.farmId = res.body.farmId;
    this.linked = res.body;   // 1.7.2: kept like NVS (login, broker, topics)
    this.log(`claimed: zone ${this.zoneId}, farm ${this.farmId} (token held in memory only)`);
    return res.body;
  }

  async connectMqtt({ rssi = -60 } = {}) {
    let username, password, will;
    if (this.kitTopics) {
      ({ mqttUsername: username, mqttPassword: password } = this.linked);
      this.sensorsTopic = this.linked.topics.telemetry;
      this.commandsTopic = this.linked.topics.cmd;
      will = { topic: this.linked.topics.status, payload: 'offline', retain: true, qos: 1 };
    } else {
      const creds = await this.http('GET', '/api/devices/mqtt-credentials');
      if (creds.status !== 200) throw new Error(`mqtt-credentials: ${creds.status} ${JSON.stringify(creds.body)}`);
      ({ mqttUsername: username, mqttPassword: password } = creds.body);
      this.sensorsTopic = `agroflow/farm/${this.farmId}/device/${this.deviceId}/sensors`;
      this.commandsTopic = `agroflow/farm/${this.farmId}/device/${this.deviceId}/commands`;
    }
    this.client = await mqtt.connectAsync(this.mqttUrl, {
      clientId: `agroflow-${this.deviceId}`, username, password, reconnectPeriod: 0, ...(will ? { will } : {}),
    });
    await this.client.subscribeAsync(this.commandsTopic);
    this.client.on('message', (_topic, payload) => {
      const command = JSON.parse(payload.toString());
      if (command.command === 'unlink') { this.unlinked = true; this.log('unlink received: forgetting the link'); return; }
      this.commands.push({ ...command, receivedAt: new Date() });
      this.log(`command received: ${command.command}${command.durationSeconds ? ` for ${command.durationSeconds}s` : ''} (${command.source})`);
    });
    if (this.kitTopics)
      await this.client.publishAsync(this.linked.topics.status,
        JSON.stringify({ state: 'online', firmware: this.firmwareVersion, rssi }), { retain: true, qos: 1 });
    this.log(`MQTT connected as ${username}, subscribed to ${this.commandsTopic}`);
  }

  // Power cut or Wi-Fi gone: the connection drops without a goodbye, so the broker publishes
  // the last will ("offline", retained).
  dropConnection() {
    this.client?.stream?.destroy();
  }

  // rssi and soilProbeOk: the kit's own report on every reading from 1.7.1.
  async publish(sensorType, value, recordedAt = null, { backlog = null, rssi = null, soilProbeOk = null } = {}) {
    const payload = { sensorType, value };
    if (rssi !== null) payload.rssi = rssi;
    if (soilProbeOk !== null) payload.soilProbeOk = soilProbeOk;
    if (recordedAt) {
      payload.recordedAt = recordedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
      payload.seq = this.seq++;
    }
    if (backlog !== null) payload.backlog = backlog;
    await this.client.publishAsync(this.sensorsTopic, JSON.stringify(payload));
  }

  async publishReadings({ soil, temperature, humidity }) {
    await this.publish('SoilMoisture', soil);
    await this.publish('Temperature', temperature);
    await this.publish('Humidity', humidity);
  }

  async waitForCommand(predicate, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.commands.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('no matching command arrived');
  }

  ack(commandId, executedAt = new Date()) {
    if (this.kitTopics)
      return this.client.publishAsync(this.linked.topics.ack, JSON.stringify({ id: commandId, executedAt: executedAt.toISOString() }), { qos: 1 });
    return this.http('POST', `/api/devices/commands/${commandId}/executed`, { deviceId: this.deviceId, executedAt: executedAt.toISOString() });
  }

  // The firmware's handler for a start command (v1.7.0): an ID already carried out gets its
  // original acknowledgement again and nothing else; a new ID is saved to flash first, then
  // the pump runs (pretend: recorded in `runs`) and the kit acknowledges. loseAck drops that
  // acknowledgement on the way, as a network cut would.
  async carryOut(command, { loseAck = false } = {}) {
    const seen = this.flash.commandIds.find(e => e.id === command.id);
    if (seen) {
      this.log(`command ${command.id} already carried out - acknowledging again, not repeating it`);
      await this.ack(command.id, seen.ackedAt);
      return { repeated: true };
    }
    const ackedAt = new Date();
    this.flash.commandIds.push({ id: command.id, ackedAt });
    if (this.flash.commandIds.length > RECENT_COMMAND_IDS) this.flash.commandIds.shift();
    if (command.command === 'start') {
      // The firmware acknowledges a second distinct start while running, but does not energise
      // the relay twice or replace the active run.
      if (!this.pumpRunning) {
        this.pumpRunning = true;
        this.runs.push({ id: command.id, seconds: runLimitSeconds(command), at: ackedAt });
      }
    } else if (command.command === 'stop') {
      this.pumpRunning = false;
      this.stops.push({ id: command.id, at: ackedAt });
    }
    if (!loseAck) await this.ack(command.id, ackedAt);
    return { repeated: false, ackedAt, pumpRunning: this.pumpRunning };
  }

  reportRun({ runtimeSeconds, triggerSource, startedAt, syncStatus = 'synced' }) {
    return this.http('POST', '/api/irrigation-events', {
      zoneId: this.zoneId, runtimeSeconds, triggerSource, syncStatus,
      startedAt: startedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
  }

  get connected() {
    return !!this.client?.connected;
  }

  async disconnectMqtt() {
    await this.client?.endAsync(true).catch(() => {});
  }

  // Pump on for a server command, like the sketch: stops at the run limit, or when MQTT has
  // been gone for lostContactMs. Resolves with { reason, runtimeSeconds, startedAt }.
  startRun(command, { lostContactMs = 3 * 60 * 1000 } = {}) {
    const startedAt = new Date();
    startedAt.setMilliseconds(0);
    const limitMs = runLimitSeconds(command) * 1000;
    let lastContact = Date.now();
    return new Promise(resolve => {
      const timer = setInterval(() => {
        const now = Date.now();
        if (this.connected) lastContact = now;
        const ran = now - startedAt.getTime();
        const stop = reason => { clearInterval(timer); resolve({ reason, runtimeSeconds: Math.round(ran / 1000), startedAt }); };
        if (ran >= limitMs) return stop('run limit');
        if (!this.connected && now - lastContact >= lostContactMs) return stop('lost contact');
      }, 100);
    });
  }

  async close() {
    await this.client?.endAsync().catch(() => {});
  }
}
