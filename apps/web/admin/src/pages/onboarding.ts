import { pageHeader, panel } from "@/ui/components";
/* The crop list is the one the engine can resolve, not free text: an unknown crop means the
 * zone never gets advice. See data/referenceData.ts. */
import { ZONE_CROPS } from "@/data/referenceData";
import { locationPickerHtml } from "@/lib/map";

/* Farmer Onboarding: two-step wizard.
 * Step 1: farmer account details. Step 2: farm details and zones. Steps and zone rows are
 * handled in the browser (wireOnboardingSteps / wireOnboardingZones in
 * src/app/interactions.ts), so the page never re-renders to change step or add a zone. */

/* What the advice needs, asked here instead of later. Soil is three cards with Loam chosen
 * ("Not sure? Pick Loam"; the engine assumes loam anyway). Size is a preset, with hectares
 * for field-scale zones. Planting is "about how many weeks ago?", which a farmer can answer
 * when a date would be a guess. */
export const SOILS: { value: string; label: string; hint: string }[] = [
  { value: "sandy", label: "Sandy", hint: "Gritty, water runs straight through" },
  { value: "loam", label: "Loam", hint: "Crumbly, holds together a little" },
  { value: "clay", label: "Clay", hint: "Sticky when wet, cracks when dry" },
];

export const AREA_PRESETS: { value: string; label: string; m2: number | null }[] = [
  { value: "small", label: "Small growing area (about 0.2 m²)", m2: 0.2 },
  { value: "field", label: "Field / plot", m2: null },
  { value: "custom", label: "Custom size", m2: null },
];

export function zoneRow(index: number): string {
  const n = index + 1;
  return `<div class="zone-row zone-setup" data-zone-row data-zone-index="${index}">
  <div class="grid split-2">
    <label class="drawer-field">
      <span>Zone ${n} name</span>
      <input
        type="text"
        data-field="zone_name_${index}"
        data-required
        data-required-message="Give zone ${n} a name."
        placeholder="e.g. North Block"
      />
    </label>

    <label class="drawer-field">
      <span>Zone ${n} crop</span>
      <select
        data-field="zone_crop_${index}"
        data-required
        data-required-message="Choose a crop for zone ${n}."
      >
        <option value="">Choose a crop…</option>
        ${ZONE_CROPS.map(
          (c) => `<option value="${c.value}">${c.label}</option>`,
        ).join("")}
      </select>
    </label>
  </div>

  <div class="drawer-field">
    <span>Zone ${n} soil</span>
    <input type="hidden" data-field="zone_soil_${index}" value="loam" data-required
      data-required-message="Choose the soil for zone ${n}." />
    <div class="soil-cards" role="radiogroup" aria-label="Zone ${n} soil">
      ${SOILS.map(
        (s) => `<button type="button" class="soil-card${s.value === "loam" ? " is-selected" : ""}"
          role="radio" aria-checked="${s.value === "loam"}"
          data-act="zone-soil" data-zone="${index}" data-soil="${s.value}">
          <b>${s.label}</b><small>${s.hint}</small>
        </button>`,
      ).join("")}
    </div>
    <small class="field-note">Not sure? Pick Loam.</small>
  </div>

  <div class="grid split-2">
    <label class="drawer-field">
      <span>Zone ${n} size</span>
      <select
        data-field="zone_area_preset_${index}"
        data-area-preset="${index}"
        data-required
        data-required-message="Choose how big zone ${n} is."
      >
        <option value="">Choose a size…</option>
        ${AREA_PRESETS.map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}
      </select>
    </label>

    <label class="drawer-field" data-area-custom="${index}" hidden>
      <span>Zone ${n} watered area (m²)</span>
      <input type="number" min="0.01" step="0.01" data-field="zone_area_m2_${index}" placeholder="e.g. 12" />
    </label>

    <label class="drawer-field">
      <span>Zone ${n} area in hectares (optional)</span>
      <input
        type="number"
        min="0.0001"
        step="0.01"
        data-field="zone_size_${index}"
        placeholder="e.g. 1.5"
      />
      <small class="field-note">Use hectares for field-scale areas; AgroFlow stores the equivalent area without changing the agronomy model.</small>
    </label>

    <label class="drawer-field">
      <span>Zone ${n}: planted about how many weeks ago? (optional)</span>
      <input type="number" min="0" max="104" step="1" data-field="zone_weeks_${index}" placeholder="e.g. 3" />
    </label>

    <label class="drawer-field">
      <span>Zone ${n} flow rate, litres a minute (optional)</span>
      <input type="number" min="0.1" step="0.1" data-field="zone_flow_${index}"
        placeholder="Or use the marked flow-rate test bottle in the app later" />
    </label>

    <label class="drawer-field">
      <span>Zone ${n} available root-zone depth in cm (optional)</span>
      <input type="number" min="1" max="300" step="1" data-field="zone_depth_cm_${index}" placeholder="e.g. 30" />
      <small class="field-note">Use this when crop roots are physically limited by shallow soil, a raised bed, container or another boundary.</small>
    </label>
  </div>

  <div class="recommend-box" data-recommend="${index}" aria-live="polite"></div>
</div>`;
}

/* The zone as the API takes it, read from the row's fields. */
export type ZoneSetupInput = {
  name: string;
  sizeHectares: number;
  cropType: string;
  soilType: string;
  areaM2: number | null;
  plantingDate: string | null;
  flowRateLpm: number | null;
  rootDepthLimitM: number | null;
};

export function readZoneSetup(v: Record<string, string>, i: number, today: Date = new Date()): ZoneSetupInput {
  const preset = AREA_PRESETS.find((a) => a.value === v[`zone_area_preset_${i}`]);
  const custom = Number(v[`zone_area_m2_${i}`]);
  const areaM2 = preset?.m2 ?? (["custom", "field"].includes(preset?.value ?? "") && custom > 0 ? custom : null);

  // Hectares stay the farmer-facing size (0010). For a measured growing area,
  // use its equivalent area (1 ha = 10 000 m²) when no hectare value was typed.
  const ha = Number(v[`zone_size_${i}`]);
  const sizeHectares = ha > 0 ? ha : areaM2 != null ? areaM2 / 10000 : 0;

  const weeksText = (v[`zone_weeks_${i}`] ?? "").trim();
  let plantingDate: string | null = null;
  if (weeksText !== "" && Number(weeksText) >= 0) {
    const d = new Date(today.getTime() - Math.round(Number(weeksText)) * 7 * 86400000);
    plantingDate = d.toISOString().slice(0, 10);
  }

  return {
    name: (v[`zone_name_${i}`] ?? "").trim(),
    sizeHectares,
    cropType: v[`zone_crop_${i}`] ?? "",
    soilType: v[`zone_soil_${i}`] || "loam",
    areaM2,
    plantingDate,
    flowRateLpm: Number(v[`zone_flow_${i}`]) > 0 ? Number(v[`zone_flow_${i}`]) : null,
    // A physical boundary can limit the crop's available root zone. Typed in
    // centimetres here and stored in metres for the FAO-56 engine.
    rootDepthLimitM: Number(v[`zone_depth_cm_${i}`]) > 0 ? Number(v[`zone_depth_cm_${i}`]) / 100 : null,
  };
}

/* What the per-field required checks cannot say. Null = fine. */
export function zoneSetupProblem(v: Record<string, string>, i: number): string | null {
  const n = i + 1;
  if (["custom", "field"].includes(v[`zone_area_preset_${i}`]) && !(Number(v[`zone_area_m2_${i}`]) > 0) && !(Number(v[`zone_size_${i}`]) > 0)) {
    return `Enter the watered area of zone ${n} in m².`;
  }
  const weeks = (v[`zone_weeks_${i}`] ?? "").trim();
  if (weeks !== "" && !(Number(weeks) >= 0 && Number(weeks) <= 104)) {
    return `Zone ${n}: weeks since planting must be between 0 and 104.`;
  }
  const flow = (v[`zone_flow_${i}`] ?? "").trim();
  if (flow !== "" && !(Number(flow) > 0 && Number(flow) <= 1000)) {
    return `Zone ${n}: the flow rate must be between 0.1 and 1000 litres a minute.`;
  }
  const depth = (v[`zone_depth_cm_${i}`] ?? "").trim();
  if (depth !== "" && !(Number(depth) >= 1 && Number(depth) <= 300)) {
    return `Zone ${n}: the soil depth must be between 1 and 300 cm.`;
  }
  const z = readZoneSetup(v, i);
  if (z.areaM2 != null && z.areaM2 > z.sizeHectares * 10000 * 1.001) {
    return `Zone ${n}: the watered area is bigger than its size in hectares.`;
  }
  return null;
}

/* After rows are rebuilt and values put back: highlight the chosen soil card and show the
 * m² box for a custom size. */
/* The zone's "Recommended for you" card in the wizard. There is no sensor yet, so nothing
 * can be saved here; the card says where to apply it later. */
export function recommendHtml(r: { available: boolean; text: string; confidence?: { level: string; reason: string } }): string {
  if (!r.available) return "";
  const level = r.confidence ? r.confidence.level.charAt(0).toUpperCase() + r.confidence.level.slice(1) : null;
  return `<div class="recommend-card">
    <b>Recommended for you</b>
    <p>${escapeText(r.text)}</p>
    ${level ? `<p class="muted"><span class="pill">${escapeText(level)} confidence</span> ${escapeText(r.confidence!.reason)}</p>` : ""}
    <p class="muted">Apply it from the farm's zone list ("Recommended settings") once the sensor's wet/dry setup is done.</p>
  </div>`;
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function syncZoneChoices(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('[data-field^="zone_soil_"]').forEach((hidden) => {
    const i = hidden.dataset["field"]!.slice("zone_soil_".length);
    root.querySelectorAll<HTMLElement>(`[data-act="zone-soil"][data-zone="${i}"]`).forEach((card) => {
      const on = card.dataset["soil"] === hidden.value;
      card.classList.toggle("is-selected", on);
      card.setAttribute("aria-checked", String(on));
    });
  });
  root.querySelectorAll<HTMLSelectElement>("[data-area-preset]").forEach((sel) => {
    const box = root.querySelector<HTMLElement>(`[data-area-custom="${sel.dataset["areaPreset"]}"]`);
    if (box) box.hidden = !["custom", "field"].includes(sel.value);
  });
}

export async function onboardingPage(): Promise<string> {
  return `
${pageHeader(
  "Onboard a Farmer",
  "Register a farmer account and set up their farm and irrigation zones.",
)}

<div class="onboarding-steps" role="tablist">
  <div class="onboarding-step active" data-step-indicator="1">
    <span class="step-num">1</span> Farmer details
  </div>
  <div class="onboarding-step" data-step-indicator="2">
    <span class="step-num">2</span> Farm details
  </div>
</div>

<div
  id="onboardingError"
  class="onboarding-error"
  style="display:none"
></div>

${panel(
  "",
  "",
  "",
  `
  <div data-step="1" class="onboarding-panel">
    <div class="fields">
      <label class="f">
        Full name
        <input
          type="text"
          data-field="fullName"
          placeholder="Thandiwe Nkosi"
        />
      </label>

      <label class="f">
        Email
        <input
          type="email"
          data-field="email"
          placeholder="thandiwe@example.com"
        />
      </label>

      <label class="f">
        Phone number
        <input
          type="text"
          data-field="phone"
          placeholder="+27 82 000 0000"
        />
      </label>
    </div>

    <div class="form-foot">
      <button class="btn" data-act="onboarding-next">
        Next: Farm details
      </button>
    </div>
  </div>

  <div
    data-step="2"
    class="onboarding-panel"
    style="display:none"
  >
    <div class="fields">
      <label class="f">
        Farm name
        <input
          type="text"
          data-field="farmName"
          placeholder="Sunrise Valley Farm"
        />
      </label>

      <label class="f">
        Nearest locality (filled in from the town you choose below)
        <input
          type="text"
          data-field="location"
          placeholder="Mahikeng, North West"
        />
      </label>

      <label class="f">
        Farm size (hectares)
        <input
          type="number"
          min="0"
          step="0.1"
          data-field="farmSize"
          placeholder="0"
        />
      </label>

      <label class="f">
        Number of irrigation zones
        <input
          type="number"
          min="0"
          max="50"
          value="0"
          data-field="zoneCount"
          data-zone-count
        />
      </label>
    </div>

    ${locationPickerHtml({ name: "onboardingLocation" })}

    <div id="zonesContainer" class="zones-container"></div>

    <div class="form-foot">
      <button class="btn ghost" data-act="onboarding-back">
        Back
      </button>
      <button class="btn" data-act="onboarding-submit">
        Onboard farmer
      </button>
    </div>
  </div>

  <div
    data-step="3"
    class="onboarding-panel"
    style="display:none"
  >
    <h3 class="onboarding-handover-title">Farmer created. Hand over now.</h3>

    <p class="onboarding-handover-lead">
      Have the farmer scan this with their phone's camera while you are still
      on site. It opens the AgroFlow bot in Telegram, and pressing Start sends
      them their login details and the app download link.
    </p>

    <div class="onboarding-handover">
      <div class="onboarding-qr">
        <canvas id="telegramQr" width="240" height="240"></canvas>

        <p class="onboarding-qr-link">
          Or type this in:<br />
          <a id="telegramLink" href="#" target="_blank" rel="noreferrer"></a>
        </p>

        <p class="onboarding-qr-expiry" id="telegramExpiry"></p>
      </div>

      <div class="onboarding-credentials">
        <h4>If they have no Telegram</h4>

        <p class="onboarding-handover-lead">
          Read these out and have them sign in on the app. They will be asked
          to choose their own password straight away.
        </p>

        <dl class="onboarding-cred-list">
          <dt>Email</dt>
          <dd id="handoverEmail"></dd>

          <dt>Temporary password</dt>
          <dd><code id="handoverPassword"></code></dd>
        </dl>

        <p class="onboarding-warning">
          This password is shown once and is not stored anywhere. If you lose
          it, use Reset password below to issue a new one. If the farmer does
          scan the QR code, the bot issues them a fresh password and the one
          above stops working.
        </p>
      </div>
    </div>

    <div id="handoverNotice" class="onboarding-error" style="display:none"></div>

    <div class="form-foot">
      <button class="btn ghost" data-act="handover-regenerate">
        Regenerate code
      </button>
      <button class="btn ghost" data-act="handover-reset-password">
        Reset password
      </button>
      <button class="btn" data-act="handover-done">
        Done
      </button>
    </div>
  </div>
`,
)}
`;
}
