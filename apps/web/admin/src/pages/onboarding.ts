
import { pageHeader, panel } from "@/ui/components";

/* ============================================================================
   Farmer Onboarding — two-step wizard.
   Step 1: farmer account details. Step 2: farm details + dynamic zones.
   Step switching and zone rows are handled client-side (see
   wireOnboardingSteps / wireOnboardingZones in src/app/interactions.ts) —
   this page never needs to re-fetch or re-render itself to move between
   steps or add a zone row.
   ========================================================================== */

function zoneRow(index: number): string {
  return `<div class="grid split-2 zone-row" data-zone-row>
    <label class="drawer-field">
      <span>Zone ${index + 1} name</span>
      <input type="text" data-field="zone_name_${index}" placeholder="e.g. North Block" />
    </label>
    <label class="drawer-field">
      <span>Zone ${index + 1} size (hectares)</span>
      <input type="number" min="0" step="0.1" data-field="zone_size_${index}" placeholder="0" />
    </label>
  </div>`;
}

export async function onboardingPage(): Promise<string> {
  return `
  ${pageHeader("Onboard a Farmer", "Register a farmer account and set up their farm and irrigation zones.")}

  <div class="onboarding-steps" role="tablist">
    <div class="onboarding-step active" data-step-indicator="1">
      <span class="step-num">1</span> Farmer details
    </div>
    <div class="onboarding-step" data-step-indicator="2">
      <span class="step-num">2</span> Farm details
    </div>
  </div>

  <div id="onboardingError" class="onboarding-error" style="display:none"></div>

  ${panel("", "", "", `
    <div data-step="1" class="onboarding-panel">
      <div class="fields">
        <label class="f">
          Full name
          <input type="text" data-field="fullName" placeholder="Thandiwe Nkosi" />
        </label>
        <label class="f">
          Email
          <input type="email" data-field="email" placeholder="thandiwe@example.com" />
        </label>
        <label class="f">
          Phone number
          <input type="text" data-field="phone" placeholder="+27 82 000 0000" />
        </label>
        <label class="f">
          Temporary password
          <input type="password" data-field="password" placeholder="At least 8 characters" />
        </label>
      </div>
      <div class="form-foot">
        <button class="btn" data-act="onboarding-next">Next: Farm details</button>
      </div>
    </div>

    <div data-step="2" class="onboarding-panel" style="display:none">
      <div class="fields">
        <label class="f">
          Farm name
          <input type="text" data-field="farmName" placeholder="Sunrise Valley Farm" />
        </label>
        <label class="f">
          Location
          <input type="text" data-field="location" placeholder="Ceres, Western Cape" />
        </label>
        <label class="f">
          Farm size (hectares)
          <input type="number" min="0" step="0.1" data-field="farmSize" placeholder="0" />
        </label>
        <label class="f">
          Latitude <span class="muted">(optional — powers the weather &amp; map view)</span>
          <input type="number" step="any" min="-90" max="90" data-field="latitude" placeholder="e.g. -33.3667" />
        </label>
        <label class="f">
          Longitude <span class="muted">(optional — powers the weather &amp; map view)</span>
          <input type="number" step="any" min="-180" max="180" data-field="longitude" placeholder="e.g. 19.3167" />
        </label>
        <label class="f">
          Number of irrigation zones
          <input type="number" min="0" max="50" value="0" data-field="zoneCount" data-zone-count />
        </label>
      </div>

      <div id="zonesContainer" class="zones-container"></div>

      <div class="form-foot">
        <button class="btn ghost" data-act="onboarding-back">Back</button>
        <button class="btn" data-act="onboarding-submit">Onboard farmer</button>
      </div>
    </div>
  `)}
  `;
}

/** Exported so interactions.ts can build a zone row without duplicating markup. */
export { zoneRow };