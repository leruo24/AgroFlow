/* "Why am I seeing this?" in the admin console.
 * Every insight, alert, Needs-attention card, KPI tile and verdict has an explanation: what
 * it is based on, the rule, how sure, what would change it, and for admins the technical
 * line (FAO-56 page and numbers, or the query behind a count).
 * Explanations are registered while a page renders and opened by id from the delegated
 * [data-act] handler. No explanation, no link: we never show a generic "based on your data". */

export type ExplanationFact = { label: string; value: string; source: string };

export type Explanation = {
  summary: string;
  facts: ExplanationFact[];
  rule: string;
  confidence: string;
  whatWouldChangeIt?: string | null;
  technical?: string | null;
};

export const WHY_LINK_TEXT = "Why am I seeing this?";

const registry = new Map<string, Explanation>();
let nextId = 0;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* A valid explanation, or null. Anything half-formed is treated as absent. */
export function asExplanation(value: unknown): Explanation | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Partial<Explanation>;
  if (typeof e.summary !== "string" || e.summary.length === 0) return null;
  return {
    summary: e.summary,
    facts: Array.isArray(e.facts)
      ? e.facts.filter((f): f is ExplanationFact =>
          !!f && typeof f.label === "string" && typeof f.value === "string" && typeof f.source === "string")
      : [],
    rule: typeof e.rule === "string" ? e.rule : "",
    confidence: typeof e.confidence === "string" ? e.confidence : "",
    whatWouldChangeIt: typeof e.whatWouldChangeIt === "string" ? e.whatWouldChangeIt : null,
    technical: typeof e.technical === "string" ? e.technical : null,
  };
}

export function registerWhy(e: Explanation): string {
  // Bounded: a long session re-rendering pages must not grow this forever.
  if (registry.size > 2000) registry.clear();
  const id = `why-${++nextId}`;
  registry.set(id, e);
  return id;
}

export function getWhy(id: string): Explanation | undefined {
  return registry.get(id);
}

/* The link, or "" when there is nothing to explain. */
export function whyLink(e: Explanation | null | undefined): string {
  const valid = asExplanation(e);
  if (!valid) return "";
  const id = registerWhy(valid);
  return `<button type="button" class="why-link" data-act="why" data-id="${esc(id)}">${esc(WHY_LINK_TEXT)}</button>`;
}

/* The drawer body: summary is the drawer's subtitle, then these sections. */
export function whyHtml(e: Explanation): string {
  const facts = e.facts.length
    ? `<div class="drawer-section"><h6>What we used</h6><div class="detail-list">${e.facts
        .map((f) => `<div class="detail-row"><span>${esc(f.label)}</span><b>${esc(f.value)}</b><small class="muted">${esc(f.source)}</small></div>`)
        .join("")}</div></div>`
    : "";

  const section = (title: string, text: string | null | undefined, cls = "") =>
    text ? `<div class="drawer-section${cls}"><h6>${esc(title)}</h6><p>${esc(text)}</p></div>` : "";

  return `
    <div class="why-body">
      <p class="why-summary">${esc(e.summary)}</p>
      ${facts}
      ${section("The rule", e.rule)}
      ${section("How sure", e.confidence)}
      ${section("What would change it", e.whatWouldChangeIt)}
      ${section("Technical (admins only)", e.technical, " why-technical")}
    </div>`;
}

/* For counts on Home: what the number counts and why it is highlighted. The
   wording sits next to the card that uses it, so the two cannot drift. */
export function countExplanation(opts: {
  /* The tile or card's own title: "Zones missing setup". */
  label: string;
  /* What it counts, as a clause: "zones are missing part of their setup". */
  what: string;
  count: number;
  counted: string;
  rule: string;
  whyHighlighted: string;
  clears: string;
  query: string;
}): Explanation {
  return {
    summary: `${opts.label}: ${opts.count}.${opts.whyHighlighted ? " " + opts.whyHighlighted : ""}`,
    facts: [
      { label: "What this counts", value: opts.what, source: opts.counted },
      { label: "Count now", value: String(opts.count), source: "when this page loaded" },
    ],
    rule: opts.rule,
    confidence: "High: counted straight from the records when this page loaded.",
    whatWouldChangeIt: opts.clears,
    technical: opts.query,
  };
}
