import { pageHeader, panel } from "@/ui/components";
/* The crop list is the engine-resolvable one, not free text: a crop the
   FAO-56 engine cannot resolve means the zone silently never gets advice.
   See data/referenceData.ts. */
import { ZONE_CROPS } from "@/data/referenceData";

/* ============================================================================
Farmer Onboarding — two-step wizard.
Step 1: farmer account details. Step 2: farm details + dynamic zones.
Step switching and zone rows are handled client-side (see
wireOnboardingSteps / wireOnboardingZones in src/app/interactions.ts) — this
page never needs to re-fetch or re-render itself to move between steps or add
a zone row.
============================================================================ */

export function zoneRow(index: number): string {
  return `<div class="grid split-2 zone-row" data-zone-row>
    <label class="drawer-field">
      <span>Zone ${index + 1} name</span>
      <input
        type="text"
        data-field="zone_name_${index}"
        data-required
        data-required-message="Give zone ${index + 1} a name."
        placeholder="e.g. North Block"
      />
    </label>

    <label class="drawer-field">
      <span>Zone ${index + 1} size (hectares)</span>
      <input
        type="number"
        min="0.1"
        step="0.1"
        data-field="zone_size_${index}"
        data-required
        data-required-message="Enter a size in hectares for zone ${index + 1}."
        placeholder="0"
      />
    </label>

    <label class="drawer-field">
      <span>Zone ${index + 1} crop</span>
      <select
        data-field="zone_crop_${index}"
        data-required
        data-required-message="Choose a crop for zone ${index + 1}."
      >
        <option value="">Choose a crop…</option>
        ${ZONE_CROPS.map(
          (c) => `<option value="${c.value}">${c.label}</option>`,
        ).join("")}
      </select>
    </label>
  </div>`;
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
        Location
        <input
          type="text"
          data-field="location"
          placeholder="Ceres, Western Cape"
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