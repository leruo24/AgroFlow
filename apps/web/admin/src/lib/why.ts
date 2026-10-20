/* The shape of an explanation, as the API sends it with advice, alerts and counts.
 * The console shows no "Why am I seeing this?" link or panel: that is for farmers, in the
 * app. Kept here so the data the console reads keeps one type. */

export type ExplanationFact = { label: string; value: string; source: string };

export type Explanation = {
  summary: string;
  facts: ExplanationFact[];
  rule: string;
  confidence: string;
  whatWouldChangeIt?: string | null;
  technical?: string | null;
};

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
