// A pretend AgroFlow irrigation kit (firmware 1.6.0's contract) for the simulation. It talks
// to the real AgroFlow.Api exactly as the ESP32 sketch does:
//   POST /api/devices/claim                    one-time enrollment code -> device token
//   GET  /api/devices/mqtt-credentials         X-Device-Token -> MQTT login
//   MQTT agroflow/farm/{farm}/device/{id}/sensors   {"sensorType","value"[,"recordedAt","seq"]}
//   MQTT agroflow/farm/{farm}/device/{id}/commands  {"id","command","durationSeconds","source","maxRunSeconds"}
//   POST /api/devices/commands/{id}/executed   ACK
//   POST /api/irrigation-events                a finished pump run
// The pump is pretend: a run is reported with the commanded duration straight away, so a
// "1-minute run" does not make the test wait a minute. startRun() runs the pump for real time
// with firmware 1.6.0's two stops (RunLimits.h): min(asked, maxRunSeconds, 120 min), and the
// lost-connection failsafe, whose 3 minutes the simulation shortens (lostContactMs).
import mqtt from 'mqtt';

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
  constructor({ apiBase, mqttUrl, deviceId, firmwareVersion = '1.5.0', log = () => {} }) {
    Object.assign(this, { apiBase, mqttUrl, deviceId, firmwareVersion, log });
    this.commands = [];
    this.seq = 1;
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
    this.log(`claimed: zone ${this.zoneId}, farm ${this.farmId} (token held in memory only)`);
    return res.body;
  }

  async connectMqtt() {
    const creds = await this.http('GET', '/api/devices/mqtt-credentials');
    if (creds.status !== 200) throw new Error(`mqtt-credentials: ${creds.status} ${JSON.stringify(creds.body)}`);
    this.sensorsTopic = `agroflow/farm/${this.farmId}/device/${this.deviceId}/sensors`;
    this.commandsTopic = `agroflow/farm/${this.farmId}/device/${this.deviceId}/commands`;
    this.client = await mqtt.connectAsync(this.mqttUrl, {
      clientId: `agroflow-${this.deviceId}`, username: creds.body.mqttUsername, password: creds.body.mqttPassword, reconnectPeriod: 0,
    });
    await this.client.subscribeAsync(this.commandsTopic);
    this.client.on('message', (_topic, payload) => {
      const command = JSON.parse(payload.toString());
      this.commands.push({ ...command, receivedAt: new Date() });
      this.log(`command received: ${command.command}${command.durationSeconds ? ` for ${command.durationSeconds}s` : ''} (${command.source})`);
    });
    this.log(`MQTT connected as ${creds.body.mqttUsername}, subscribed to ${this.commandsTopic}`);
  }

  async publish(sensorType, value, recordedAt = null) {
    const payload = { sensorType, value };
    if (recordedAt) {
      payload.recordedAt = recordedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
      payload.seq = this.seq++;
    }
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

  ack(commandId) {
    return this.http('POST', `/api/devices/commands/${commandId}/executed`, { deviceId: this.deviceId, executedAt: new Date().toISOString() });
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
