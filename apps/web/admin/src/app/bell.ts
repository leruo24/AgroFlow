/* The notification bell in the header. Staff never use Telegram (docs/telegram-farmers-only.md),
 * so the notices that used to go to their Telegram are here instead, and on Home's
 * "Needs attention" list, which counts the same things:
 *   - a new farm or zone request         (was a Telegram message to every admin)
 *   - a call-back that is due            (enquiry follow-up)
 *   - a new enquiry nobody has taken on  (was a Telegram message to every admin)
 *   - an open critical alert             (zones or equipment)
 *   - a kit offline or faulty            (the equipment monitor)
 *   - a farmer saying their farm's place is wrong (the app's setup wizard)
 *   - a farm in drought mode
 * The count is checked when the shell opens and every minute. Each line opens the list it
 * counts, already filtered, with the same actions as Home's cards. */

import { api } from "@/data/api";
import { getDroughtFarms, getEnquirySummary, getStaffNotices } from "@/services/agroFlowApi";
import { esc } from "@/lib/format";

export type BellCounts = {
  requestsPending: number;
  callbacksDue: number;
  enquiriesWaiting: number;
  criticalAlerts: number;
  kitsOffline: number;
  locationProblems?: number;
  droughtFarms?: number;
};

export type BellItem = { key: string; title: string; count: number; act: string };

export const BELL_REFRESH_MS = 60_000;

/** The lines, most urgent first, leaving out anything at zero. */
export function bellItems(c: BellCounts): BellItem[] {
  return [
    { key: "requests", title: "New requests waiting", count: c.requestsPending, act: "go-requests-pending" },
    { key: "callbacks", title: "Call-backs due", count: c.callbacksDue, act: "go-enquiries" },
    { key: "enquiries", title: "Enquiries waiting for a call", count: c.enquiriesWaiting, act: "go-enquiries" },
    { key: "alerts", title: "Open critical alerts", count: c.criticalAlerts, act: "go-alerts-critical" },
    { key: "kits", title: "Kits offline or faulty", count: c.kitsOffline, act: "go-kits-offline" },
    { key: "notices", title: "Location problems from farmers", count: c.locationProblems ?? 0, act: "go-drought-community" },
    { key: "drought", title: "Farms in drought mode", count: c.droughtFarms ?? 0, act: "go-drought-community" },
  ].filter((i) => i.count > 0);
}

export function bellMenuHtml(items: BellItem[]): string {
  const lines = items.length
    ? items.map((i) => `
        <a href="#" class="bell-item" data-act="${esc(i.act)}" data-bell="${esc(i.key)}">
          <b>${i.count}</b> <span>${esc(i.title)}</span>
        </a>`).join("")
    : `<p class="muted bell-empty">Nothing needs attention right now.</p>`;
  return `
    <div class="menu-head"><b>Notifications</b><span>The same items as Home's Needs attention.</span></div>
    ${lines}
    <a href="#dashboard" class="bell-all">Open Home</a>`;
}

/* Each source may fail on its own: one unavailable queue must not empty the bell. */
export async function loadBellCounts(): Promise<BellCounts> {
  const [requests, alerts, hardware, enquiries, notices, drought] = await Promise.all([
    api.getServiceRequests().catch(() => []),
    api.getAlerts().catch(() => []),
    api.getHardware().catch(() => []),
    getEnquirySummary().catch(() => null),
    getStaffNotices().catch(() => []),
    getDroughtFarms().catch(() => []),
  ]);
  return {
    requestsPending: requests.filter((r) => r.status === "pending").length,
    callbacksDue: Number(enquiries?.callbacksDue) || 0,
    enquiriesWaiting: Number(enquiries?.waiting) || 0,
    criticalAlerts: alerts.filter((a) => !["Resolved", "Closed"].includes(a.status) && (a.priority === "Critical" || a.priority === "High")).length,
    kitsOffline: hardware.filter((h) => h.status === "Offline" || h.status === "Fault").length,
    locationProblems: Array.isArray(notices) ? notices.length : 0,
    droughtFarms: Array.isArray(drought) ? drought.length : 0,
  };
}

export async function refreshBell(): Promise<void> {
  const badge = document.getElementById("bellCount");
  const menu = document.getElementById("bellMenu");
  const btn = document.getElementById("bellBtn");
  if (!badge || !menu || !btn) return;
  const items = bellItems(await loadBellCounts());
  const total = items.reduce((n, i) => n + i.count, 0);
  badge.textContent = total > 99 ? "99+" : String(total);
  badge.hidden = total === 0;
  btn.setAttribute("aria-label", total ? `Notifications: ${total} need attention` : "Notifications: nothing needs attention");
  menu.innerHTML = bellMenuHtml(items);
}

let timer: number | null = null;
let outsideBound = false;

/* main.ts rebuilds the shell on every sign-in, so this runs again; the timer and the
 * outside-click listener are set up once. */
export function initBell(): void {
  const btn = document.getElementById("bellBtn");
  const menu = document.getElementById("bellMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains("open");
    menu.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open) void refreshBell();
  });
  // Choosing a line opens its page; close the menu behind it.
  menu.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".bell-item, .bell-all")) menu.classList.remove("open");
  });

  if (!outsideBound) {
    outsideBound = true;
    document.addEventListener("click", (e) => {
      const b = document.getElementById("bellBtn");
      const m = document.getElementById("bellMenu");
      if (b && m && !b.contains(e.target as Node) && !m.contains(e.target as Node)) m.classList.remove("open");
    });
  }

  void refreshBell();
  if (timer === null) timer = window.setInterval(() => void refreshBell(), BELL_REFRESH_MS);
}
