/* Item 6c: "Interested in AgroFlow? Get a call back" on the landing page.

   No login: it posts to POST /api/public/enquiries, which checks every field
   again, limits each connection to a few enquiries an hour, and drops what a
   bot fills in the hidden "website" field. The checks here are only so a
   person is told at once; the server's word is final and is shown as-is. */

import { ZONE_CROPS } from "@/data/referenceData";

const API_BASE = (import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "").trim();

const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "North West", "Northern Cape", "Western Cape",
];

// The engine's crops (the same list as zones), plus Other.
const CROPS: { value: string; label: string }[] = [...ZONE_CROPS, { value: "other", label: "Other" }];

export const CONSENT_TEXT =
  "I agree that AgroFlow may contact me about this enquiry and store these details for that purpose.";

export const ENQUIRY_SECTION_HTML = `
  <section class="landing-section enquiry" id="enquire" aria-labelledby="enquireHeading">
    <h2 id="enquireHeading" class="landing-h2">Interested in AgroFlow? Get a call back</h2>
    <p class="landing-step-body">Leave your number and a representative will phone you to talk it through.</p>
    <button type="button" class="btn" id="enquiryOpen" aria-expanded="false" aria-controls="enquiryForm">Ask for a call</button>

    <form id="enquiryForm" class="enquiry-form" hidden novalidate>
      <label class="f">Full name *<input name="fullName" autocomplete="name" required /></label>
      <label class="f">Phone number *<input name="phone" type="tel" autocomplete="tel" placeholder="082 123 4567" required /></label>
      <label class="f">Email (optional)<input name="email" type="email" autocomplete="email" /></label>
      <label class="f">Province *
        <select name="province" required>
          <option value="">Choose…</option>
          ${PROVINCES.map((p) => `<option value="${p}">${p}</option>`).join("")}
        </select>
      </label>
      <label class="f">Town *<input name="town" autocomplete="address-level2" required /></label>
      <label class="f">Farm size in hectares (optional)<input name="farmSizeHa" type="number" min="0.01" step="0.01" /></label>

      <fieldset class="enquiry-crops">
        <legend>What do you grow, or want to grow? *</legend>
        ${CROPS.map((c) => `<label class="check"><input type="checkbox" name="crops" value="${c.value}" /> ${c.label}</label>`).join("")}
        <label class="f enquiry-other" hidden>Which other crop?<input name="cropsOther" /></label>
      </fieldset>

      <fieldset class="enquiry-time">
        <legend>Best time to call *</legend>
        ${["morning", "afternoon", "evening"].map((t) =>
          `<label class="check"><input type="radio" name="bestTime" value="${t}" /> ${t[0].toUpperCase()}${t.slice(1)}</label>`).join("")}
      </fieldset>

      <label class="f">Anything else? (optional)<textarea name="notes" rows="3" maxlength="1000"></textarea></label>

      <!-- Honeypot: hidden from people; a bot that fills it is ignored. -->
      <div class="enquiry-hp" aria-hidden="true">
        <label>Website<input name="website" tabindex="-1" autocomplete="off" /></label>
      </div>

      <label class="check enquiry-consent"><input type="checkbox" name="consent" /> ${CONSENT_TEXT} *</label>

      <p class="enquiry-error" role="alert" hidden></p>
      <button type="submit" class="btn">Send</button>
    </form>

    <p class="enquiry-thanks" role="status" hidden></p>
  </section>`;

type EnquiryBody = {
  fullName: string; phone: string; email: string | null; province: string; town: string;
  farmSizeHa: number | null; crops: string[]; cropsOther: string | null; bestTime: string;
  notes: string | null; consent: boolean; website: string;
};

export function readEnquiry(form: HTMLFormElement): EnquiryBody {
  const data = new FormData(form);
  const text = (k: string): string => String(data.get(k) ?? "").trim();
  return {
    fullName: text("fullName"),
    phone: text("phone"),
    email: text("email") || null,
    province: text("province"),
    town: text("town"),
    farmSizeHa: text("farmSizeHa") ? Number(text("farmSizeHa")) : null,
    crops: data.getAll("crops").map(String),
    cropsOther: text("cropsOther") || null,
    bestTime: text("bestTime"),
    notes: text("notes") || null,
    consent: data.get("consent") !== null,
    website: text("website"),
  };
}

/* What a person should fix before sending, in the server's words. */
export function enquiryProblem(b: EnquiryBody): string | null {
  if (b.fullName.length < 2) return "Please give your full name.";
  const digits = b.phone.replace(/\D/g, "");
  if (!((digits.length === 10 && digits.startsWith("0")) || (digits.length === 11 && digits.startsWith("27"))))
    return "Please give a South African phone number, for example 082 123 4567.";
  if (!b.province) return "Please choose your province.";
  if (b.town.length < 2) return "Please give your town.";
  if (b.crops.length === 0) return "Please choose at least one crop.";
  if (b.crops.includes("other") && !b.cropsOther) return "Please say which other crop.";
  if (!b.bestTime) return "Please choose the best time to call.";
  if (!b.consent) return "Please tick the box to agree that we may contact you about this enquiry.";
  return null;
}

export function wireEnquiry(root: HTMLElement): void {
  const open = root.querySelector<HTMLButtonElement>("#enquiryOpen");
  const form = root.querySelector<HTMLFormElement>("#enquiryForm");
  const error = root.querySelector<HTMLElement>(".enquiry-error");
  const thanks = root.querySelector<HTMLElement>(".enquiry-thanks");
  const other = root.querySelector<HTMLElement>(".enquiry-other");
  if (!open || !form || !error || !thanks || !other) return;

  const show = (): void => {
    form.hidden = false;
    open.setAttribute("aria-expanded", "true");
    open.hidden = true;
    form.querySelector<HTMLInputElement>('[name="fullName"]')?.focus();
  };
  open.addEventListener("click", show);
  // The app's "Ask for a call" link lands on #enquire with the form open.
  if (window.location.hash === "#enquire") show();

  form.addEventListener("change", () => {
    other.hidden = !form.querySelector<HTMLInputElement>('input[name="crops"][value="other"]')?.checked;
  });

  let sending = false;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (sending) return;
    const body = readEnquiry(form);
    const problem = enquiryProblem(body);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    sending = true;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;

    void fetch(`${API_BASE}/api/public/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const reply = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!res.ok) throw new Error(reply.error || "We could not send your enquiry. Please try again.");
        form.hidden = true;
        thanks.textContent = reply.message || "Thank you, a representative will call you within 2 working days.";
        thanks.hidden = false;
      })
      .catch((err: unknown) => {
        error.textContent = err instanceof Error ? err.message : "We could not send your enquiry. Please try again.";
        error.hidden = false;
      })
      .finally(() => {
        sending = false;
        if (submit) submit.disabled = false;
      });
  });
}
