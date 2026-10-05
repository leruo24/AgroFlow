/* Platform health: the sidebar light, the header chip and Home's card.
 *
 * All three read the same GET /api/admin/health, so they cannot disagree -
 * which is what the three separate "Monitoring not yet implemented" strings
 * they replace were at least honest about.
 *
 * Nothing here ever shows green on no information. A check that could not be
 * read says so; an endpoint that cannot be reached shows a Retry. The whole
 * point of this panel is to be trusted during an incident, and a status light
 * that lies once is never trusted again.
 */

import { esc, fmtAgo } from "@/lib/format";
import { getPlatformHealth, type HealthResponse, type HealthCheck } from "@/services/agroFlowApi";

let cached: HealthResponse | null = null;
let timer: number | undefined;

const TONE: Record<string, { cls: string; word: string }> = {
  ok: { cls: "good", word: "All systems normal" },
  warning: { cls: "warn", word: "Needs attention" },
  down: { cls: "bad", word: "Problem" },
};

/* ------------------------------------------------------------------ *
 * The card on Home
 * ------------------------------------------------------------------ */

export async function healthPanelHtml(): Promise<string> {
  try {
    cached = await getPlatformHealth();
  } catch (error) {
    console.warn("[admin] health check unavailable:", error);

    return panelShell(`
      <div class="health-unavailable">
        <p>The health check could not be reached, so the services below are unknown.</p>
        <button class="btn ghost" data-act="refresh-health">Retry</button>
      </div>`);
  }

  return panelShell(`
    <div class="health-grid">
      ${cached.checks.map(healthCard).join("")}
    </div>
    <p class="health-foot muted">
      Checked ${esc(fmtAgo(cached.checkedAt))}. Refreshes every minute.
    </p>`);
}

function panelShell(body: string): string {
  return `
    <section class="panel" id="systemHealth">
      <div class="panel-head">
        <div>
          <h3>System health</h3>
          <p class="muted">The six things that have to work for a farm to be watered.</p>
        </div>
        <button class="btn ghost sm" data-act="refresh-health">Refresh</button>
      </div>
      <div class="panel-body">${body}</div>
    </section>`;
}

function healthCard(c: HealthCheck): string {
  const tone = TONE[c.status]?.cls ?? "neutral";

  return `
    <div class="health-card health-${tone}">
      <div class="health-top">
        <span class="dot-r dot-${tone}${c.status === "down" ? " dot-throb" : ""}"></span>
        <b>${esc(c.name)}</b>
      </div>
      <div class="health-status">${esc(c.detail)}</div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * The sidebar light and the header chip
 * ------------------------------------------------------------------ */

export function startHealthPolling(): void {
  void refreshHealthIndicators();

  // Once a minute. Frequent enough that an admin watching the sidebar during
  // an incident sees it change; rare enough that six database queries per
  // open tab stay negligible.
  if (timer !== undefined) window.clearInterval(timer);
  timer = window.setInterval(() => void refreshHealthIndicators(), 60_000);
}

export function stopHealthPolling(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

export async function refreshHealthIndicators(): Promise<void> {
  const sidebar = document.getElementById("platformStatusText");
  const chip = document.getElementById("headerStatusChip");

  if (!sidebar && !chip) return;

  try {
    cached = await getPlatformHealth();
  } catch {
    // Unknown, said as unknown. Showing the last known good state here
    // would be the one moment it matters that it is wrong.
    if (sidebar) {
      sidebar.innerHTML = `<i class="dot dot-unknown"></i>Status unavailable`;
    }
    if (chip) {
      chip.className = "status-chip status-chip-unknown";
      chip.textContent = "Status unavailable";
    }
    return;
  }

  const tone = TONE[cached.overall] ?? { cls: "neutral", word: "Unknown" };

  if (sidebar) {
    sidebar.innerHTML = `<i class="dot dot-${tone.cls}"></i>${esc(tone.word)}`;
  }

  if (chip) {
    chip.className = `status-chip status-chip-${tone.cls}`;
    // The chip is narrow, so it carries the count of what is wrong rather
    // than the sentence - the sentence is one click away in the card.
    const bad = cached.checks.filter((c) => c.status !== "ok").length;
    chip.textContent = bad === 0 ? "All systems normal" : `${bad} need${bad === 1 ? "s" : ""} attention`;
  }
}

/* Re-renders just the health card in place, for the Refresh button, without
   reloading the whole page and losing the admin's scroll position. */
export async function refreshHealthPanel(): Promise<void> {
  const host = document.getElementById("healthPanel");
  if (!host) return;

  host.innerHTML = await healthPanelHtml();
  await refreshHealthIndicators();
}
