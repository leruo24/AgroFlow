import QRCode from "qrcode";
import { esc, fmtDate } from "@/lib/format";

/* The kit setup card: everything an installer needs to reach a kit's setup page, without
 * Serial Monitor. Shown in the Register-a-kit wizard (Review and the success screen), in the
 * kit drawer and in the farm drawer.
 *
 * The setup hotspot is worked out from the device ID exactly as the firmware does (apName /
 * apPassword in AgroFlowIrrigationNode.ino) and the API does (DeviceSetupCommands): name
 * "AgroFlow-Setup-" + the last 4 characters, password "AF-" + the last 6. The password is
 * low-sensitivity, like the sticker on the box. The enrollment code is for staff and
 * installers only: it is shown here while it is valid and unused, and never printed on the
 * label. */

export const SETUP_PAGE_ADDRESS = "192.168.4.1";
// ESP32 device IDs: the chip's 48-bit MAC as 12 hex digits (getDeviceId in the firmware).
export const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/;

export const normaliseDeviceId = (id: string | null | undefined): string =>
  (id ?? "").trim().toUpperCase();

export const setupNetworkName = (deviceId: string): string =>
  `AgroFlow-Setup-${normaliseDeviceId(deviceId).slice(-4)}`;

export const setupNetworkPassword = (deviceId: string): string =>
  `AF-${normaliseDeviceId(deviceId).slice(-6)}`;

export type KitCardData = {
  hardwareId?: string | number | null;
  deviceId: string | null;
  zoneId?: number | null;
  zoneName?: string | null;
  farmName?: string | null;
  status?: string | null;
  lastSeen?: string | null;
  /** Only while it is valid and unused (the API leaves it out otherwise). */
  enrollmentCode?: string | null;
  enrollmentExpiresAt?: string | null;
  /** On Review: the code does not exist yet, it is created when staff confirm. */
  codePending?: boolean;
  /** The three numbered steps (wizard and drawers). */
  showSteps?: boolean;
};

const copyButton = (value: string, what: string): string =>
  `<button type="button" class="btn ghost sm" data-act="copy-text" data-copy="${esc(value)}" aria-label="Copy the ${esc(what)}">Copy</button>`;

const row = (label: string, value: string, copy?: { value: string; what: string }, testId?: string): string =>
  `<div class="detail-row kit-card-row"><span>${esc(label)}</span><b${testId ? ` data-kit-field="${testId}"` : ""}>${value}</b>${copy ? copyButton(copy.value, copy.what) : ""}</div>`;

export function kitSetupCardHtml(k: KitCardData): string {
  const id = normaliseDeviceId(k.deviceId);
  const known = DEVICE_ID_PATTERN.test(id);
  const name = known ? setupNetworkName(id) : null;
  const password = known ? setupNetworkPassword(id) : null;

  const rows = [
    known
      ? row("Device ID", `<span class="mono">${esc(id)}</span>`, { value: id, what: "device ID" }, "deviceId")
      : row("Device ID", `<span class="muted">Known when the kit first connects. This card fills in by itself once it has.</span>`, undefined, "deviceId"),
    known
      ? row("Setup Wi-Fi", `<span class="mono">${esc(name!)}</span>`, { value: name!, what: "setup Wi-Fi name" }, "network")
      : row("Setup Wi-Fi", `<span class="muted">AgroFlow-Setup- and the last 4 characters of the device ID</span>`, undefined, "network"),
    known
      ? row("Password", `<span class="mono">${esc(password!)}</span>`, { value: password!, what: "setup Wi-Fi password" }, "password")
      : row("Password", `<span class="muted">AF- and the last 6 characters of the device ID</span>`, undefined, "password"),
    row("Setup page", `<span class="mono">${SETUP_PAGE_ADDRESS}</span>`),
  ];
  if (k.status) rows.push(row("Status", esc(k.status), undefined, "status"));
  if (k.lastSeen !== undefined) rows.push(row("Last seen", esc(k.lastSeen ? fmtDate(k.lastSeen) : "Never"), undefined, "lastSeen"));
  if (k.enrollmentCode) {
    rows.push(row("Enrollment code", `<span class="mono">${esc(k.enrollmentCode)}</span>`, { value: k.enrollmentCode, what: "enrollment code" }, "code"));
    if (k.enrollmentExpiresAt) rows.push(row("Code valid until", esc(fmtDate(k.enrollmentExpiresAt)), undefined, "expires"));
  } else if (k.codePending) {
    rows.push(row("Enrollment code", `<span class="muted">Created when you confirm. Valid for 24 hours, for one kit.</span>`, undefined, "code"));
  }

  const join = known
    ? `Join the Wi-Fi <b class="mono">${esc(name!)}</b> (password <b class="mono">${esc(password!)}</b>) on a phone.`
    : `Join the kit's Wi-Fi <b>AgroFlow-Setup-…</b> on a phone (its name and password are printed in Serial Monitor at boot, and on this card once the kit is known).`;
  const steps = k.showSteps === false ? "" : `
    <ol class="kit-card-steps">
      <li>${join}</li>
      <li>A setup page opens by itself. If it does not, go to <b class="mono">${SETUP_PAGE_ADDRESS}</b>.</li>
      <li>Choose the farm's Wi-Fi, type its password${k.enrollmentCode || k.codePending ? " and the enrollment code" : ""}, and press Save.</li>
    </ol>`;

  const print = known ? `
    <button type="button" class="btn ghost sm" data-act="print-kit-label" data-device-id="${esc(id)}"
      data-zone-id="${esc(String(k.zoneId ?? ""))}" data-zone-name="${esc(k.zoneName ?? "")}" data-farm-name="${esc(k.farmName ?? "")}">Print kit label</button>` : "";

  return `
    <section class="kit-setup-card" data-kit-card data-hardware-id="${esc(String(k.hardwareId ?? ""))}" aria-label="Kit setup card">
      <h4 class="kit-card-title">Kit setup card</h4>
      <div class="detail-list">${rows.join("")}</div>
      ${steps}
      ${print}
      ${kitHelpHtml()}
    </section>`;
}

/* "Reconnect or reset": what the farmer (or an installer on site) can do without staff, and what
 * needs staff. It describes firmware 1.7.1 as it is: 3 quick power cycles or 15 minutes without
 * Wi-Fi open the setup page and keep the enrollment; 5 quick power cycles wipe it. The printable
 * page is public/guides (the farmer web app has the same file). */
export const KIT_GUIDE_PATH = "/guides/reconnect-or-reset-your-kit.html";

export function kitHelpHtml(): string {
  return `
    <details class="kit-help" data-kit-help>
      <summary>Reconnect or reset</summary>
      <p><b>New Wi-Fi (no code needed, the kit stays linked):</b> the farmer taps Kit → Change Wi-Fi in the app,
        or switches the kit off and on 3 times quickly (off again within 10 s each time), or waits 15 minutes
        without Wi-Fi. Then join <span class="mono">AgroFlow-Setup-XXXX</span> (password on this card or the label),
        open <span class="mono">${SETUP_PAGE_ADDRESS}</span> and choose the Wi-Fi. The kit keeps watering meanwhile.</p>
      <p><b>Move to another zone or farm:</b> staff only. Register the kit again with a new enrollment code.</p>
      <p class="kit-help-warn"><b>Full reset:</b> off and on 5 times quickly. This wipes the Wi-Fi and the enrollment:
        the kit stops watering until staff create a new enrollment code and it claims again. Only ask a farmer to do
        this when you will create that code.</p>
      <p><a href="${KIT_GUIDE_PATH}" target="_blank" rel="noopener" data-kit-guide-link>Printable guide for the farmer</a></p>
    </details>`;
}

/* The label: sticker-size (A6) with the device ID, the setup Wi-Fi and its password, and a QR
 * code that opens the kit in the farmer app. Never the enrollment code. */
export type KitLabelData = { deviceId: string; zoneId?: number | null; zoneName?: string | null; farmName?: string | null };

// The farmer web app's address (VITE_DOWNLOADS_WEB_APP_URL), read when needed so this module also
// loads outside Vite (the label's unit test).
const webAppBase = (): string =>
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.["VITE_DOWNLOADS_WEB_APP_URL"] ?? "").trim();

export const kitAppUrl = (zoneId?: number | null, base = webAppBase()): string | null =>
  base ? `${base.replace(/\/$/, "")}/kit${zoneId ? `?zone=${zoneId}` : ""}` : null;

export async function kitLabelHtml(l: KitLabelData, appBase = webAppBase()): Promise<string> {
  const id = normaliseDeviceId(l.deviceId);
  const url = kitAppUrl(l.zoneId, appBase);
  const qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 220 }) : null;
  const where = [l.farmName, l.zoneName].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AgroFlow kit label ${esc(id)}</title>
<style>
@page { size: A6 portrait; margin: 6mm; }
body { font-family: system-ui, sans-serif; color: #183344; margin: 0; }
.label { border: 1px solid #183344; border-radius: 8px; padding: 6mm; }
h1 { font-size: 18pt; margin: 0 0 2mm; } p { margin: 1.5mm 0; font-size: 11pt; }
.k { color: #526575; font-size: 9pt; display: block; } .v { font-family: ui-monospace, monospace; font-size: 13pt; font-weight: 700; }
img { display: block; margin: 3mm auto 1mm; width: 42mm; height: 42mm; } .small { font-size: 8.5pt; color: #526575; text-align: center; }
</style></head><body>
<div class="label" data-kit-label>
<h1>AgroFlow kit</h1>
${where ? `<p class="small" style="text-align:left">${esc(where)}</p>` : ""}
<p><span class="k">Device ID</span><span class="v" data-label-field="deviceId">${esc(id)}</span></p>
<p><span class="k">Setup Wi-Fi</span><span class="v" data-label-field="network">${esc(setupNetworkName(id))}</span></p>
<p><span class="k">Password</span><span class="v" data-label-field="password">${esc(setupNetworkPassword(id))}</span></p>
<p><span class="k">Setup page</span><span class="v">${SETUP_PAGE_ADDRESS}</span></p>
<p class="small" style="text-align:left" data-label-wifi-help>Changing Wi-Fi? Open the app → Kit, or switch off/on 3 times.</p>
${qr ? `<img src="${qr}" alt="QR code: open this kit in the AgroFlow app" data-label-qr><p class="small">Scan to open this kit in the AgroFlow app</p>`
      : `<p class="small">Open the AgroFlow app, then Kit.</p>`}
</div></body></html>`;
}

/* Opens the label in a new tab and prints it. Printing is started from here, not by a script in
 * the label, so the label page has no script at all. */
export async function printKitLabel(l: KitLabelData): Promise<boolean> {
  const html = await kitLabelHtml(l);
  const w = window.open("", "_blank", "width=460,height=680");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Automated browsers have no printer; a person gets the print dialog.
  if (!navigator.webdriver) window.setTimeout(() => w.print(), 400);
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission: the selection fallback.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
