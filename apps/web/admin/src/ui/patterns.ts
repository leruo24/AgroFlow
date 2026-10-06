/* The interaction patterns every admin page uses.
 *
 * WHY THIS FILE EXISTS
 * The console was a set of dense tables whose only affordance was a row of
 * tiny text links - "View Edit Disable Reset Connect Delete" - and free-text
 * fields where an admin had to remember a farm's exact name. Every page
 * solved the same problems its own way, so there was no way to fix them all
 * at once.
 *
 * These are those solutions, once: a searchable picker instead of typing, a
 * stepped wizard instead of a long form, an empty state that says what to do
 * next, an error state with a Retry rather than a frozen skeleton, and a
 * confirm dialog that names the consequence in plain words.
 *
 * Built on the existing tokens in styles/main.css - no new colours, no new
 * framework, no new dependency. Vanilla template strings, like the rest of
 * this app.
 */

import { whyLink, type Explanation } from "@/lib/why";
import { esc } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { isAbort } from "@/lib/navigation";

/* ------------------------------------------------------------------ *
 * Empty states
 * ------------------------------------------------------------------ */

/* An empty list is not an error, and it is not nothing: it is a place the
   admin has arrived at expecting something. Saying what WOULD be here and
   giving them the button that creates the first one turns a dead end into
   the next step. */
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

/* ------------------------------------------------------------------ *
 * Error states
 * ------------------------------------------------------------------ */

/* The rule this enforces: never an endless skeleton. A page that cannot load
   says so in a sentence an admin can act on, and gives them the one button
   that might fix it. `retryAct` is a data-act value wired in interactions. */
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
        <p>${esc(opts.detail ?? "Something went wrong loading this page.")}</p>
      </div>
      ${opts.retryAct
        ? `<button class="btn ghost" data-act="${esc(opts.retryAct)}"${
            opts.retryId ? ` data-id="${esc(opts.retryId)}"` : ""
          }>Retry</button>`
        : `<button class="btn ghost" data-act="retry-page">Retry</button>`}
    </div>`;
}

/* Wraps a page body so a thrown loader becomes a Retry instead of a blank
   screen or a skeleton that never resolves. Every page render goes through
   this. */
export async function withErrorState(
  title: string,
  render: () => Promise<string>,
): Promise<string> {
  try {
    return await render();
  } catch (error) {
    // A cancelled navigation is not a failure, and nobody is looking at the
    // page it belonged to. lib/navigation.ts already keeps aborts from
    // surfacing; this is the belt to that brace.
    if (isAbort(error)) return "";

    console.error(`[admin] ${title} failed to load:`, error);

    return errorState({
      title: `${title} could not be loaded`,
      detail:
        error instanceof Error
          ? error.message
          : "The server did not answer. Check your connection and try again.",
    });
  }
}

/* ------------------------------------------------------------------ *
 * Pickers
 * ------------------------------------------------------------------ */

export type PickerOption = {
  value: string;
  /* The name a person recognises. */
  label: string;
  /* Email, location, crop - whatever disambiguates two similar labels. */
  secondary?: string;
  /* Shown on the right, e.g. "Kit assigned". */
  meta?: string;
  disabled?: boolean;
};

/* A searchable list instead of a text field.
 *
 * Typing a farm's name from memory is where the mistakes came from: a
 * typo creates a second farm, a wrong name attaches a kit to someone else's
 * zone. A picker cannot produce a value that does not exist.
 *
 * Rendered as a filterable list rather than a <select> because a select
 * shows one line at a time and cannot show the secondary text that tells two
 * "Test Farm"s apart. */
export function picker(opts: {
  name: string;
  label: string;
  options: PickerOption[];
  value?: string;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
  hint?: string;
  /* Shown by the wizard when nothing has been chosen. Named after the thing,
     not the field: "Choose the farmer this farm belongs to." */
  requiredMessage?: string;
}): string {
  const hasOptions = opts.options.length > 0;

  /* data-required on the HIDDEN input, not on the search box. The search box
     holds whatever was typed to filter the list, which is not a choice -
     requiring it would pass validation for a farm nobody selected. */
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

/* ------------------------------------------------------------------ *
 * Wizards
 * ------------------------------------------------------------------ */

export type WizardStep = {
  title: string;
  /* One line under the step title saying what this step is for. */
  hint?: string;
  bodyHtml: string;
};

/* A stepped form with a review step at the end.
 *
 * One long form with eight fields gives no sense of progress and validates
 * everything at the end, when the admin has already forgotten what they
 * typed in field two. Steps validate as you go, Back keeps what you entered,
 * and the last step shows everything before anything is written. */
export function wizard(opts: {
  id: string;
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  confirmLabel?: string;
  /* The data-act that actually writes. Left off for a wizard whose confirm
     is wired by hand. wireWizards() validates every step before this fires,
     so the handler can trust what collectFields() gives it. */
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

/* ------------------------------------------------------------------ *
 * Detail panels
 * ------------------------------------------------------------------ */

export type DetailSection = {
  title: string;
  bodyHtml: string;
};

export type DetailAction = {
  label: string;
  act: string;
  id?: string;
  /* `danger` gets the red treatment AND is expected to confirm first. */
  tone?: "primary" | "ghost" | "danger";
};

/* Replaces the row of tiny text links.
 *
 * Clicking a row opens one place that holds everything about that item -
 * its fields, the things it is related to (each a link), and its actions as
 * real buttons with labels rather than four-character words squeezed into a
 * table cell. */
export function detailPanel(opts: {
  title: string;
  subtitle?: string;
  badgeHtml?: string;
  sections: DetailSection[];
  actions?: DetailAction[];
}): string {
  return `
    <div class="detail">
      <div class="detail-head">
        <div>
          <h3>${esc(opts.title)}</h3>
          ${opts.subtitle ? `<p class="muted">${esc(opts.subtitle)}</p>` : ""}
        </div>
        ${opts.badgeHtml ?? ""}
      </div>

      ${opts.actions?.length
        ? `<div class="detail-actions">
             ${opts.actions
               .map(
                 (a) => `
               <button
                 class="btn ${a.tone === "danger" ? "danger" : a.tone === "ghost" ? "ghost" : ""}"
                 data-act="${esc(a.act)}"${a.id ? ` data-id="${esc(a.id)}"` : ""}
               >${esc(a.label)}</button>`,
               )
               .join("")}
           </div>`
        : ""}

      ${opts.sections
        .map(
          (s) => `
        <section class="detail-section">
          <h6>${esc(s.title)}</h6>
          ${s.bodyHtml}
        </section>`,
        )
        .join("")}
    </div>`;
}

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

/* Related items, each one a link that opens that item's own detail. This is
   the "farmer ↔ farms ↔ zones ↔ kit ↔ alerts ↔ requests" chain: from any one
   of them you can reach the others without going back to a list and
   searching. */
export function relatedList(
  items: { label: string; secondary?: string; act: string; id: string }[],
  emptyText = "None.",
): string {
  if (items.length === 0) return `<p class="muted">${esc(emptyText)}</p>`;

  return `<ul class="related-list">${items
    .map(
      (i) => `
      <li>
        <a href="#" data-act="${esc(i.act)}" data-id="${esc(i.id)}">
          <b>${esc(i.label)}</b>
          ${i.secondary ? `<span>${esc(i.secondary)}</span>` : ""}
        </a>
      </li>`,
    )
    .join("")}</ul>`;
}

/* ------------------------------------------------------------------ *
 * The "needs attention" queue
 * ------------------------------------------------------------------ */

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
  /* Item 2c: what the count counts and why it is in the queue. */
  why?: Explanation;
};

/* Home's action queue.
 *
 * The dashboard used to open on twelve numbers, none of which told an admin
 * what to DO. These are the things waiting for a person, each one a button
 * that opens exactly that work. A card with a count of zero is not rendered
 * at all - an empty queue should look empty, not like a list of things that
 * are fine. */
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

/* The card plus its "Why am I seeing this?" link, side by side rather than
   nested - a button inside a button is invalid HTML. */
function attentionItem(c: AttentionCard): string {
  const link = whyLink(c.why);
  return link ? `<div class="attn-item">${attentionCard(c)}${link}</div>` : attentionCard(c);
}

export function attentionQueue(cards: AttentionCard[]): string {
  const live = cards.filter((c) => c.count > 0);

  if (live.length === 0) {
    return `
      <div class="attn-clear">
        <span class="attn-clear-ico" aria-hidden="true">${Icon.circleCheck}</span>
        <div>
          <b>Nothing needs attention</b>
          <p class="muted">No waiting requests, open critical alerts, offline kits or failed reports.</p>
        </div>
      </div>`;
  }

  return `<div class="attn-grid">${live.map(attentionItem).join("")}</div>`;
}

/* ------------------------------------------------------------------ *
 * Confirmation
 * ------------------------------------------------------------------ */

/* The body of a confirm dialog for something that cannot be undone.
 *
 * `consequence` is the sentence that matters: not "Are you sure?" but what
 * will actually happen, in words. Archive and disable are preferred over
 * delete everywhere, and where both exist the dialog says which is which. */
export function confirmBody(opts: {
  consequence: string;
  detail?: string;
  alternative?: string;
}): string {
  return `
    <div class="confirm-body">
      <p class="confirm-consequence">${esc(opts.consequence)}</p>
      ${opts.detail ? `<p class="muted">${esc(opts.detail)}</p>` : ""}
      ${opts.alternative
        ? `<p class="confirm-alt">${esc(opts.alternative)}</p>`
        : ""}
    </div>`;
}
