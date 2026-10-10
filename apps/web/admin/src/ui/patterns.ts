/* The interaction patterns every admin page uses, defined once: a searchable picker instead
 * of typing, a stepped wizard instead of a long form, an empty state that says what to do
 * next, an error state with a Retry instead of a frozen skeleton, and a confirm dialog that
 * names the consequence in plain words.
 * Built on the existing tokens in styles/main.css, with plain template strings like the
 * rest of this app; no new colours, framework or dependency. */

import { dismissButton, hiddenBy, historyList, type Dismissal, type DismissView } from "@/lib/dismiss";
import { whyLink, type Explanation } from "@/lib/why";
import { esc, fmtDateTimeSast } from "@/lib/format";
import type { Handling } from "@/types/models";
import { Icon } from "@/lib/icons";
import { isAbort } from "@/lib/navigation";
import { plainError } from "@/lib/plainError";

/* Empty states */

/* An empty list is not an error: the admin came here expecting something. We say what
 * would be here and give the button that creates the first one. */
export function emptyState(opts: {
  title: string;
  body?: string;
  actionLabel?: string;
  actionAttrs?: string;
  icon?: string;
}): string {
  return `
    <div class="empty-state-card">
      <span class="empty-state-ico" aria-hidden="true">${opts.icon ?? Icon.inbox}</span>
      <h4>${esc(opts.title)}</h4>
      ${opts.body ? `<p>${esc(opts.body)}</p>` : ""}
      ${opts.actionLabel
        ? `<button class="btn" ${opts.actionAttrs ?? ""}>${esc(opts.actionLabel)}</button>`
        : ""}
    </div>`;
}

/* Error states */

/* Never an endless skeleton. A page that cannot load says so in a sentence the admin can
 * act on, with the one button that might fix it. `retryAct` is a data-act value wired in
 * interactions. */
export function errorState(opts: {
  title: string;
  detail?: string;
  retryAct?: string;
  retryId?: string;
}): string {
  return `
    <div class="error-state-card" role="alert">
      <span class="error-state-ico" aria-hidden="true">${Icon.circleX}</span>
      <div class="error-state-body">
        <h4>${esc(opts.title)}</h4>
        <p>${esc(plainError(opts.detail ?? "", "Something went wrong loading this page."))}</p>
      </div>
      ${opts.retryAct
        ? `<button class="btn ghost" data-act="${esc(opts.retryAct)}"${
            opts.retryId ? ` data-id="${esc(opts.retryId)}"` : ""
          }>Retry</button>`
        : `<button class="btn ghost" data-act="retry-page">Retry</button>`}
    </div>`;
}

/* Wraps a page body so a thrown loader becomes a Retry instead of a blank screen or a
 * skeleton that never ends. Every page render goes through this. */
export async function withErrorState(
  title: string,
  render: () => Promise<string>,
): Promise<string> {
  try {
    return await render();
  } catch (error) {
    // A cancelled navigation is not a failure, and nobody is looking at its page.
    // lib/navigation.ts already hides aborts; this is a second check.
    if (isAbort(error)) return "";

    console.error(`[admin] ${title} failed to load:`, error);

    return errorState({
      title: `${title} could not be loaded`,
      detail: plainError(error, "The server did not answer. Check your connection and try again."),
    });
  }
}

/* Pickers */

export type PickerOption = {
  value: string;
  /* The name a person recognises. */
  label: string;
  /* Email, location, crop: whatever tells two similar labels apart. */
  secondary?: string;
  /* Shown on the right, e.g. "Kit assigned". */
  meta?: string;
  disabled?: boolean;
};

/* A searchable list instead of a text field. Typing a farm's name from memory leads to
 * mistakes (a typo makes a second farm, a wrong name puts a kit on someone else's zone); a
 * picker cannot produce a value that does not exist. A filterable list, not a <select>,
 * because a select cannot show the secondary text that tells two "Test Farm"s apart. */
export function picker(opts: {
  name: string;
  label: string;
  options: PickerOption[];
  value?: string;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
  hint?: string;
  /* Shown by the wizard when nothing has been chosen. Named after the thing, not the field:
   * "Choose the farmer this farm belongs to." */
  requiredMessage?: string;
}): string {
  const hasOptions = opts.options.length > 0;

  /* data-required goes on the hidden input, not the search box. The search box holds filter
   * text, not a choice, so requiring it would pass validation with no farm selected. */
  const requiredAttrs = opts.required
    ? ` data-required data-required-message="${esc(
        opts.requiredMessage ?? `Choose a ${opts.label.toLowerCase()} before continuing.`,
      )}"`
    : "";

  return `
    <div class="picker" data-picker="${esc(opts.name)}">
      <label class="picker-label" for="picker-search-${esc(opts.name)}">
        ${esc(opts.label)}${opts.required ? ` <span class="req" aria-hidden="true">*</span>` : ""}
      </label>
      ${opts.hint ? `<p class="picker-hint">${esc(opts.hint)}</p>` : ""}

      ${hasOptions
        ? `
        <input
          type="search"
          class="picker-search"
          id="picker-search-${esc(opts.name)}"
          placeholder="${esc(opts.placeholder ?? "Search…")}"
          autocomplete="off"
          aria-controls="picker-list-${esc(opts.name)}"
        />
        <div class="picker-list" id="picker-list-${esc(opts.name)}" role="listbox">
          ${opts.options.map((o) => pickerOption(opts.name, o, o.value === opts.value)).join("")}
        </div>
        <input type="hidden" data-field="${esc(opts.name)}" value="${esc(opts.value ?? "")}"${requiredAttrs} />`
        : `<p class="picker-empty">${esc(opts.emptyText ?? "Nothing to choose from yet.")}</p>
           <input type="hidden" data-field="${esc(opts.name)}" value=""${requiredAttrs} />`}
    </div>`;
}

function pickerOption(name: string, o: PickerOption, selected: boolean): string {
  return `
    <button
      type="button"
      class="picker-option${selected ? " is-selected" : ""}${o.disabled ? " is-disabled" : ""}"
      role="option"
      aria-selected="${selected}"
      data-picker-for="${esc(name)}"
      data-value="${esc(o.value)}"
      ${o.disabled ? "disabled" : ""}
      data-search="${esc(`${o.label} ${o.secondary ?? ""}`.toLowerCase())}"
    >
      <span class="picker-option-main">
        <b>${esc(o.label)}</b>
        ${o.secondary ? `<span class="picker-option-sub">${esc(o.secondary)}</span>` : ""}
      </span>
      ${o.meta ? `<span class="picker-option-meta">${esc(o.meta)}</span>` : ""}
    </button>`;
}

/* Wizards */

export type WizardStep = {
  title: string;
  /* One line under the step title saying what this step is for. */
  hint?: string;
  bodyHtml: string;
};

/* A stepped form with a review step at the end. Each step is checked as it is filled in, Back keeps what
 * was entered, and the last step shows everything before anything is saved. */
export function wizard(opts: {
  id: string;
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  confirmLabel?: string;
  /* The data-act that saves. Left off for a wizard whose confirm is wired by hand.
   * wireWizards() validates every step first, so the handler can trust collectFields(). */
  confirmAct?: string;
  confirmId?: string;
}): string {
  return `
    <div class="wizard" data-wizard="${esc(opts.id)}" data-step="0" data-steps="${opts.steps.length}">
      <div class="wizard-head">
        <h3>${esc(opts.title)}</h3>
        ${opts.subtitle ? `<p class="muted">${esc(opts.subtitle)}</p>` : ""}
      </div>

      <ol class="wizard-rail" aria-label="Steps">
        ${opts.steps
          .map(
            (s, i) => `
          <li class="wizard-rail-step${i === 0 ? " is-current" : ""}" data-rail="${i}">
            <span class="wizard-rail-n">${i + 1}</span>
            <span class="wizard-rail-t">${esc(s.title)}</span>
          </li>`,
          )
          .join("")}
      </ol>

      <div class="wizard-body">
        ${opts.steps
          .map(
            (s, i) => `
          <section class="wizard-step${i === 0 ? " is-current" : ""}" data-wizard-step="${i}">
            <h4>${esc(s.title)}</h4>
            ${s.hint ? `<p class="muted wizard-step-hint">${esc(s.hint)}</p>` : ""}
            ${s.bodyHtml}
          </section>`,
          )
          .join("")}
      </div>

      <p class="wizard-error" data-wizard-error hidden role="alert"></p>

      <div class="wizard-foot">
        <button type="button" class="btn ghost" data-wizard-back disabled>Back</button>
        <span class="wizard-count"><b data-wizard-current>1</b> of ${opts.steps.length}</span>
        <button type="button" class="btn" data-wizard-next>Next</button>
        <button
          type="button"
          class="btn"
          data-wizard-confirm
          ${opts.confirmAct ? `data-act="${esc(opts.confirmAct)}"` : ""}
          ${opts.confirmId ? `data-id="${esc(opts.confirmId)}"` : ""}
          hidden
        >
          ${esc(opts.confirmLabel ?? "Confirm")}
        </button>
      </div>
    </div>`;
}

/* Detail panels */

export type DetailSection = {
  title: string;
  bodyHtml: string;
};

export type DetailAction = {
  label: string;
  act: string;
  id?: string;
  /* `danger` gets the red style and should ask for confirmation first. */
  tone?: "primary" | "ghost" | "danger";
};

/* A list of label/value rows inside a detail section. */
export function detailList(rows: [string, string][]): string {
  if (rows.length === 0) return `<p class="muted">Nothing recorded.</p>`;

  return `<div class="detail-list">${rows
    .map(
      ([label, value]) =>
        `<div class="detail-row"><span>${esc(label)}</span><b>${value}</b></div>`,
    )
    .join("")}</div>`;
}

/* Related items, each a link to that item's own detail: the "farmer ↔ farms ↔ zones ↔ kit
 * ↔ alerts ↔ requests" chain, so any one can be reached from the others without a search. */

/* The "needs attention" queue */

export type AttentionCard = {
  title: string;
  /* The number that makes it worth looking at. */
  count: number;
  /* One line saying what the admin should do about it. */
  body: string;
  act: string;
  id?: string;
  tone: "bad" | "warn" | "info";
  icon?: string;
  /* What the count counts and why it is in the queue. */
  why?: Explanation;
  /* What the count is made of (ids). A dismissed critical card comes back when this changes,
   * because the condition happened again. */
  conditionKey?: string;
  /* Its own name for dismissing, when two cards open the same page. */
  key?: string;
};

/* Home's action queue: things waiting for a person, each a button that opens that work. A
 * card with a count of zero is not shown, so an empty queue looks empty. */
export function attentionCard(c: AttentionCard): string {
  return `
    <button class="attn-card attn-${c.tone}" data-act="${esc(c.act)}"${
      c.id ? ` data-id="${esc(c.id)}"` : ""
    }>
      <span class="attn-ico" aria-hidden="true">${c.icon ?? ""}</span>
      <span class="attn-body">
        <span class="attn-title">${esc(c.title)}</span>
        <span class="attn-sub">${esc(c.body)}</span>
      </span>
      <span class="attn-count">${c.count}</span>
    </button>`;
}

/* The card plus its "Why am I seeing this?" link, side by side, not nested: a button
 * inside a button is invalid HTML. */
function attentionItem(c: AttentionCard): string {
  // Each card can be dismissed (×), next to it like the Why link.
  const dismiss = dismissButton({
    kind: "attention", key: c.key ?? c.act, title: `${c.title}: ${c.count}`, critical: c.tone === "bad", conditionKey: c.conditionKey ?? null,
  });
  return `<div class="attn-item">${attentionCard(c)}${whyLink(c.why)}${dismiss}</div>`;
}

/* Active / Dismissed / All. Dismissed cards leave the queue but are listed in its history
 * with Restore. */
export function attentionQueue(cards: AttentionCard[], dismissals: Dismissal[] = [], view: DismissView = "active"): string {
  const live = cards.filter((c) => c.count > 0
    && !hiddenBy(dismissals, "attention", c.key ?? c.act, c.tone === "bad", c.conditionKey));
  const history = view === "active" ? "" : `
    <h4 class="sub-heading">Dismissed</h4>
    ${historyList(dismissals, "attention", "No attention card has been dismissed.")}`;
  if (view === "dismissed") return history;

  if (live.length === 0) {
    return `
      <div class="attn-clear">
        <span class="attn-clear-ico" aria-hidden="true">${Icon.circleCheck}</span>
        <div>
          <b>Nothing needs attention</b>
          <p class="muted">No waiting requests, open critical alerts, offline kits or failed reports.</p>
        </div>
      </div>${history}`;
  }

  return `<div class="attn-grid">${live.map(attentionItem).join("")}</div>${history}`;
}

/* Confirmation */

/* Who is handling an item */

/* The "Handled by" cell. Nobody can put work in someone else's name, so there is no
 * picker: "I'll handle this" uses the caller's own name, someone else's can only be taken
 * over (with a reason), and only the handler can let it go. */
export function handlingCell(
  kind: "requests" | "alerts" | "maintenance",
  item: Handling & { id: string | number },
  myId: string | undefined,
  done = false,
): string {
  const id = esc(String(item.id));
  const since = item.claimedAt ? `<small class="muted">since ${esc(fmtDateTimeSast(item.claimedAt))}</small>` : "";

  if (!item.handledByName) {
    return done
      ? `<span class="muted">Nobody</span>`
      : `<a href="#" data-act="claim-item" data-kind="${kind}" data-id="${id}">I'll handle this</a>`;
  }

  if (myId && item.handledById === myId) {
    return `<b>You</b> ${since}
      ${done ? "" : `<a href="#" data-act="release-item" data-kind="${kind}" data-id="${id}">Let go</a>`}`;
  }

  return `${esc(item.handledByName)} ${since}
    ${done ? "" : `<a href="#" data-act="take-over-item" data-kind="${kind}" data-id="${id}" data-handler="${esc(item.handledByName)}">Take over</a>`}`;
}
