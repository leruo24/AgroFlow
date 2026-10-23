/* Platform health: the sidebar light, the header chip and Home's card. All three read the
 * same GET /api/admin/health, so they always agree.
 * Nothing ever shows green without information: a check that could not be read says so,
 * and an unreachable endpoint shows a Retry. This panel must be trustworthy during an
 * incident. */

import { clearedConditions, dismissButton, hiddenBy, historyList, viewOf, viewToggle, type Dismissal } from "@/lib/dismiss";
import { getAdminDismissals, clearDismissalCondition } from "@/services/agroFlowApi";
import { esc, fmtAgo } from "@/lib/format";
import { getPlatformHealth, type HealthResponse, type HealthCheck } from "@/services/agroFlowApi";
import { BLOCKED_BY_EXTENSION, NetworkFailure, SERVER_UNREACHABLE, serverAnswersPing } from "@/lib/plainError";

let cached: HealthResponse | null = null;
let timer: number | undefined;

const TONE: Record<string, { cls: string; word: string }> = {
  ok: { cls: "good", word: "All systems normal" },
  warning: { cls: "warn", word: "Needs attention" },
  down: { cls: "bad", word: "Problem" },
};

/* Why the health check gave no answer. Only a failed /api/public/ping is an outage: the
 * health route can fail on its own (a broken diagnostic, a slow query) while the server and
 * every farm keep working, and that must never read as "the server can't be reached". */
type Unavailable = "server-down" | "blocked" | "check-failed";

async function whyUnavailable(error: unknown): Promise<Unavailable> {
  if (error instanceof NetworkFailure) return error.blocked ? "blocked" : "server-down";
  return (await serverAnswersPing()) ? "check-failed" : "server-down";
}

const UNAVAILABLE: Record<Unavailable, { panel: string; short: string }> = {
  "server-down": { panel: SERVER_UNREACHABLE, short: "Server unreachable" },
  blocked: { panel: BLOCKED_BY_EXTENSION, short: "Status blocked" },
  "check-failed": {
    panel: "The server is up, but its health check did not answer, so the services below are unknown. This is a problem with the check, not an outage.",
    short: "Status check failed",
  },
};

/* The card on Home */

export async function healthPanelHtml(): Promise<string> {
  // Warnings can be dismissed; dismissed ones leave the grid and are listed under Dismissed.
  const dismissals = await getAdminDismissals().catch(() => [] as Dismissal[]);
  const view = viewOf("health");
  try {
    cached = await getPlatformHealth();
  } catch (error) {
    console.warn("[admin] health check unavailable:", error);
    const why = await whyUnavailable(error);

    return panelShell(`
      <div class="health-unavailable" data-health-unavailable="${why}">
        <p>${esc(UNAVAILABLE[why].panel)}</p>
        <button class="btn ghost" data-act="refresh-health">Retry</button>
      </div>`);
  }

  // A check that is OK again (or has changed) closes its critical dismissal, so a repeat
  // shows again.
  const warnings = new Map(cached.checks.filter((c) => c.status !== "ok").map((c) => [c.key, c.status]));
  for (const d of clearedConditions(dismissals, "health", warnings)) {
    void clearDismissalCondition(d.id).catch(() => undefined);
  }

  const visible = cached.checks.filter((c) =>
    c.status === "ok" || !hiddenBy(dismissals, "health", c.key, c.status === "down", c.status));
  const history = view === "active" ? "" : `<h4 class="sub-heading">Dismissed</h4>${historyList(dismissals, "health", "No health warning has been dismissed.")}`;

  return panelShell(`
    ${view === "dismissed" ? "" : `<div class="health-grid">${visible.map(healthCard).join("")}</div>`}
    ${history}
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
        <div class="row-actions">${viewToggle("health")}<button class="btn ghost sm" data-act="refresh-health">Refresh</button></div>
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
        ${c.status === "ok" ? "" : dismissButton({ kind: "health", key: c.key, title: `${c.name}: ${c.detail}`, critical: c.status === "down", conditionKey: c.status })}
      </div>
      <div class="health-status">${esc(c.detail)}</div>
    </div>`;
}

/* The sidebar light and the header chip */

export function startHealthPolling(): void {
  void refreshHealthIndicators();

  // Once a minute: often enough to see a change during an incident, rarely enough that six
  // database queries per open tab do not matter.
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
  } catch (error) {
    // Unknown is shown as unknown; showing the last good state would be wrong exactly when it
    // matters. Whether the server itself is down is the ping's answer, not this check's.
    const why = await whyUnavailable(error);
    if (sidebar) {
      sidebar.innerHTML = `<i class="dot dot-unknown"></i>${esc(UNAVAILABLE[why].short)}`;
    }
    if (chip) {
      chip.className = `status-chip status-chip-${why === "server-down" ? "bad" : "unknown"}`;
      chip.textContent = UNAVAILABLE[why].short;
    }
    return;
  }

  const tone = TONE[cached.overall] ?? { cls: "neutral", word: "Unknown" };

  if (sidebar) {
    sidebar.innerHTML = `<i class="dot dot-${tone.cls}"></i>${esc(tone.word)}`;
  }

  if (chip) {
    chip.className = `status-chip status-chip-${tone.cls}`;
    // The chip is narrow, so it shows how many checks are failing; the full sentence is one
    // click away in the card.
    const bad = cached.checks.filter((c) => c.status !== "ok").length;
    chip.textContent = bad === 0 ? "All systems normal" : `${bad} need${bad === 1 ? "s" : ""} attention`;
  }
}

/* Re-renders only the health card, for the Refresh button, so the admin keeps their scroll
 * position. */
export async function refreshHealthPanel(): Promise<void> {
  const host = document.getElementById("healthPanel");
  if (!host) return;

  host.innerHTML = await healthPanelHtml();
  await refreshHealthIndicators();
}
