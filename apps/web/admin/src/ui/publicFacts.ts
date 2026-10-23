import { legalDraftHtml } from "@/ui/legalDraft";

// The public pages' facts from the API, so they match what farmers see in the app:
//   /service-pricing  the staff-edited example price  (GET /api/public/service-price)
//   /terms, /privacy  each document's text, version and date (GET /api/public/legal[/{key}])
// The page renders first with the bundled copies (identical to the server's 0.1-draft); the
// server's values replace them when they arrive. If the API cannot be reached the bundled
// copy stays, and nothing is shown as missing.
const API_BASE = (import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "").trim().replace(/\/$/, "");

type Price = { installationZar: number; monthlyZar: number; zones: number; label: string };
type LegalDoc = { key: string; version: string; date: string; status: string };

const rand = (n: number) => `R${Math.round(n).toLocaleString("en-US")}`;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

// Only a Markdown answer is a document; anything else (an error page, JSON) keeps the copy.
async function getMarkdown(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}${path}`);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/markdown|text\/plain/.test(type)) return null;
    const text = await response.text();
    return /^\s*#/.test(text) ? text : null;
  } catch {
    return null;
  }
}

export function wirePublicFacts(root: HTMLElement): void {
  if (!API_BASE) return;
  const prices = root.querySelectorAll<HTMLElement>("[data-price]");
  if (prices.length) {
    void getJson<Price>("/api/public/service-price").then((price) => {
      if (!price || typeof price !== "object" || !root.isConnected) return;
      prices.forEach((el) => {
        const value = el.dataset.price === "installation" ? price.installationZar : price.monthlyZar;
        if (Number.isFinite(value)) el.querySelector("[data-price-amount]")!.textContent = rand(value);
      });
    });
  }
  const article = root.querySelector<HTMLElement>("[data-legal-doc]");
  if (article) {
    const key = article.dataset.legalDoc!;
    void Promise.all([
      getJson<{ documents: LegalDoc[] }>("/api/public/legal"),
      getMarkdown(`/api/public/legal/${encodeURIComponent(key)}`),
    ]).then(([list, text]) => {
      if (!root.isConnected) return;
      const doc = Array.isArray(list?.documents) ? list.documents.find((d) => d.key === key) : undefined;
      const version = root.querySelector<HTMLElement>("[data-legal-version]");
      if (doc && version) {
        version.textContent = `${doc.version} · `;
        const time = document.createElement("time");
        time.dateTime = doc.date;
        time.textContent = doc.date;
        version.append(time);
      }
      // An approved document has no draft banner; a draft keeps it.
      if (doc && doc.status !== "draft") root.querySelector("[data-legal-draft]")?.remove();
      if (text) article.innerHTML = legalDraftHtml(text);
    });
  }
}
