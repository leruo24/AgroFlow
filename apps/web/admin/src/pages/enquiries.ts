/* Item 6c: the Enquiries tab on Requests - people interested in AgroFlow who
   asked for a call back from the landing page or the app's login screen.

   [I'll handle this] → [Log call] → an outcome. "Wants AgroFlow" offers
   [Start onboarding]; "Call back later" sets a reminder that shows on Home
   when due; three "No answer"s suggest closing; "Not interested" needs a
   reason. An enquiry that has ended can have its personal details deleted
   (POPIA), keeping what the statistics need. Every step is on the record. */

import { badge } from "@/ui/components";
import { esc, fmtDateTimeSast } from "@/lib/format";
import type { Enquiry, EnquiryCall } from "@/services/agroFlowApi";

export const REASONS: { value: string; label: string }[] = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "no_internet", label: "No reliable internet or WiFi" },
  { value: "no_electricity", label: "No electricity at the farm" },
  { value: "not_farming", label: "Not farming right now" },
  { value: "has_system", label: "Already have an irrigation system" },
  { value: "not_right_time", label: "Not the right time" },
  { value: "thinking", label: "Wants to think about it" },
  { value: "other", label: "Other" },
];

export const OUTCOMES: { value: string; label: string }[] = [
  { value: "wants", label: "Wants AgroFlow" },
  { value: "callback", label: "Call back later" },
  { value: "no_answer", label: "No answer" },
  { value: "not_interested", label: "Not interested" },
];

const CROP_LABELS: Record<string, string> = {
  potato: "Potato", tomato: "Tomato", citrus: "Citrus", leafy_veg: "Leafy vegetables",
  maize: "Maize", dry_beans: "Dry beans",
};

export function reasonLabel(e: { reason: string | null; reasonOther: string | null }): string {
  if (!e.reason) return "";
  if (e.reason === "other") return e.reasonOther ? `Other: ${e.reasonOther}` : "Other";
  return REASONS.find((r) => r.value === e.reason)?.label ?? e.reason;
}

export function cropsText(e: Pick<Enquiry, "crops" | "cropsOther">): string {
  return e.crops.map((c) => (c === "other" ? e.cropsOther || "Other" : CROP_LABELS[c] ?? c)).join(", ");
}

export function isCallbackDue(e: Enquiry, now = Date.now()): boolean {
  return e.status === "open" && !!e.callbackAt && new Date(e.callbackAt).getTime() <= now;
}

export function enquiryStatus(e: Enquiry): string {
  const tone = (t: "good" | "warn" | "neutral" | "bad"): typeof t => t;
  switch (e.status) {
    case "new": return badge("New", tone("warn"));
    case "won": return badge("Became a farmer", tone("good"));
    case "lost": return `${badge("Not interested", tone("neutral"))}<div class="muted">${esc(reasonLabel(e))}</div>`;
    case "closed": return badge("Closed", tone("neutral"));
  }
  if (isCallbackDue(e)) return `${badge("Call-back due", tone("bad"))}<div class="muted">${esc(fmtDateTimeSast(e.callbackAt!))}</div>`;
  if (e.callbackAt) return `${badge("Call back", tone("neutral"))}<div class="muted">${esc(fmtDateTimeSast(e.callbackAt))}</div>`;
  if (e.outcome === "wants") return badge("Wants AgroFlow", tone("good"));
  if (e.noAnswerCount > 0) return badge(`No answer ×${e.noAnswerCount}`, tone("warn"));
  return badge("Open", tone("neutral"));
}

function handledCell(e: Enquiry, myId: string | undefined): string {
  const ended = e.status === "won" || e.status === "lost" || e.status === "closed";
  if (!e.handledByName) {
    return ended ? `<span class="muted">Nobody</span>`
      : `<a href="#" data-act="enquiry-claim" data-id="${e.id}">I'll handle this</a>`;
  }
  if (myId && e.handledBy === myId) return `<b>You</b>`;
  return `${esc(e.handledByName)}${ended ? ""
    : ` <a href="#" data-act="enquiry-take-over" data-id="${e.id}" data-handler="${esc(e.handledByName)}">Take over</a>`}`;
}

export function enquiryActions(e: Enquiry, myId: string | undefined): string {
  const ended = e.status === "won" || e.status === "lost" || e.status === "closed";
  if (ended) {
    return e.anonymisedAt
      ? `<span class="muted">Personal details deleted</span>`
      : e.status === "won"
        ? `<span class="muted">Onboarded</span>`
        : `<a href="#" class="row-act" data-act="enquiry-anonymise" data-id="${e.id}">Delete personal details</a>`;
  }
  if (!myId || e.handledBy !== myId) return `<span class="muted">${e.handledByName ? "—" : "Take it on first"}</span>`;

  return `<div class="row-actions">
    <button type="button" class="btn ghost" data-act="enquiry-log-call" data-id="${e.id}">Log call</button>
    ${e.outcome === "wants" ? `<a href="#" class="row-act" data-act="enquiry-onboard" data-id="${e.id}">Start onboarding</a>` : ""}
    ${e.noAnswerCount >= 3
      ? `<a href="#" class="row-act" data-act="enquiry-close" data-id="${e.id}" title="Three calls with no answer">Close (no answer ×${e.noAnswerCount})</a>`
      : ""}
  </div>`;
}

function enquiryRow(e: Enquiry, myId: string | undefined): string {
  const who = e.anonymisedAt
    ? `<span class="muted">Details deleted</span>`
    : `<a href="#" class="cell-link" data-act="view-enquiry" data-id="${e.id}"><strong>${esc(e.fullName ?? "")}</strong></a>
       <div class="muted">${e.phone ? `<a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : ""}${e.email ? ` · ${esc(e.email)}` : ""}</div>`;
  const where = [e.town, e.province].filter(Boolean).join(", ");
  const size = e.farmSizeHa != null ? ` · ${e.farmSizeHa} ha` : "";

  return `<tr data-enquiry="${e.id}">
    <td>${who}</td>
    <td>${esc(where)}<div class="muted">${esc(cropsText(e))}${esc(size)}</div></td>
    <td>${esc(e.bestTime[0].toUpperCase() + e.bestTime.slice(1))}</td>
    <td>${esc(fmtDateTimeSast(e.createdAt))}</td>
    <td>${enquiryStatus(e)}</td>
    <td>${handledCell(e, myId)}</td>
    <td>${enquiryActions(e, myId)}</td>
  </tr>`;
}

export function enquiriesTable(rows: Enquiry[], myId: string | undefined): string {
  return `<div class="table-wrap">
    <table class="requests-table">
      <thead><tr>
        <th>Who</th><th>Where and what</th><th>Best time</th><th>Received</th><th>Status</th><th>Handled by</th><th>Next</th>
      </tr></thead>
      <tbody>${rows.length ? rows.map((e) => enquiryRow(e, myId)).join("")
        : `<tr><td colspan="7" class="muted">No enquiries yet. They arrive from the landing page's "Get a call back" form and the app's login screen.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

export function callHistory(calls: EnquiryCall[]): string {
  if (!calls.length) return `<p class="muted">No calls logged yet.</p>`;
  return `<ol class="timeline">${calls.map((c) => {
    const outcome = OUTCOMES.find((o) => o.value === c.outcome)?.label ?? c.outcome;
    const extra = [
      c.reason ? reasonLabel({ reason: c.reason, reasonOther: c.reasonOther }) : "",
      c.callbackAt ? `call back ${fmtDateTimeSast(c.callbackAt)}` : "",
      c.note ?? "",
    ].filter(Boolean).join(" · ");
    return `<li class="timeline-item"><span class="timeline-dot" aria-hidden="true"></span><div>
      <b>${esc(outcome)} - called by ${esc(c.callerName)}</b>
      <span class="timeline-when">${esc(fmtDateTimeSast(c.calledAt))}</span>
      ${extra ? `<div class="muted">${esc(extra)}</div>` : ""}
    </div></li>`;
  }).join("")}</ol>`;
}

/* The Log call drawer's body. Outcome buttons; the reason only for Not
   interested (with words for Other); a date and time only for Call back. */
export function logCallHtml(): string {
  return `<div class="log-call">
    <fieldset class="outcomes"><legend>How did the call go?</legend>
      ${OUTCOMES.map((o) => `<label class="check"><input type="radio" name="callOutcome" value="${o.value}" /> ${esc(o.label)}</label>`).join("")}
    </fieldset>
    <label class="f" data-call-when hidden>When to call back
      <input type="datetime-local" name="callbackAt" />
    </label>
    <label class="f" data-call-reason hidden>Why not? (required)
      <select name="callReason">
        <option value="">Choose a reason…</option>
        ${REASONS.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join("")}
      </select>
    </label>
    <label class="f" data-call-reason-other hidden>Say why (required for Other)
      <input name="callReasonOther" maxlength="200" />
    </label>
    <label class="f">Note (optional)<textarea name="callNote" rows="3" maxlength="1000"></textarea></label>
  </div>`;
}

/* What the drawer holds, and what is still missing - in the server's words. */
export function readLogCall(root: ParentNode): {
  call: { outcome: string; reason: string | null; reasonOther: string | null; note: string | null; callbackAt: string | null };
  problem: string | null;
} {
  const val = (sel: string): string =>
    (root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(sel)?.value ?? "").trim();
  const outcome = root.querySelector<HTMLInputElement>('input[name="callOutcome"]:checked')?.value ?? "";
  const reason = val('[name="callReason"]');
  const reasonOther = val('[name="callReasonOther"]');
  const when = val('[name="callbackAt"]');
  const callbackAt = when ? new Date(when).toISOString() : null;

  let problem: string | null = null;
  if (!outcome) problem = "Choose how the call went.";
  else if (outcome === "not_interested" && !reason) problem = "Choose why they are not interested.";
  else if (outcome === "not_interested" && reason === "other" && !reasonOther) problem = "Say why, in a few words.";
  else if (outcome === "callback" && !callbackAt) problem = "Choose when to call back.";
  else if (outcome === "callback" && callbackAt && new Date(callbackAt).getTime() <= Date.now()) problem = "The call-back time must be in the future.";

  return {
    call: {
      outcome,
      reason: outcome === "not_interested" ? reason || null : null,
      reasonOther: outcome === "not_interested" && reason === "other" ? reasonOther : null,
      note: val('[name="callNote"]') || null,
      callbackAt: outcome === "callback" ? callbackAt : null,
    },
    problem,
  };
}

export function syncLogCall(root: ParentNode): void {
  const outcome = root.querySelector<HTMLInputElement>('input[name="callOutcome"]:checked')?.value;
  const reason = root.querySelector<HTMLSelectElement>('[name="callReason"]')?.value;
  const show = (sel: string, on: boolean): void => {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.hidden = !on;
  };
  show("[data-call-when]", outcome === "callback");
  show("[data-call-reason]", outcome === "not_interested");
  show("[data-call-reason-other]", outcome === "not_interested" && reason === "other");
}
