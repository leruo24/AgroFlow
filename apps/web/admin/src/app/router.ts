/* Typed hash router with animated page transitions. */

import type { NavItem, PageId, PageOptions, PageRenderer, SettingsTab } from "@/types/models";
import { dashboardPage } from "@/pages/dashboard";
import { usersPage } from "@/pages/users";
import { farmsPage } from "@/pages/farms";
import { onboardingPage } from "@/pages/onboarding";
import { requestsPage } from "@/pages/requests";
import { mqttLoginsPage } from "@/pages/mqttLogins";
import { hardwarePage, alertsPage, maintenancePage } from "@/pages/operations";
import {
  irrigationPage, reportsPage, activityPage, settingsPage, settingsTabBody, SETTINGS_TABS,
} from "@/pages/analytics";
import { skeletonPage } from "@/ui/components";
import { animateIn, swapContent } from "@/lib/animate";
import { esc } from "@/lib/format";
import { Icon } from "@/lib/icons";

/* The sidebar, in the order an admin actually works.
 *
 * Home first because it is the queue of what needs a person. Requests
 * second because that is the inbound work. Then the things those requests
 * are ABOUT, from people outward: farmers, their farms and zones, the kits
 * in those zones. Then the things that happen to them - alerts, maintenance.
 * Then the outputs: reports. Then the record: activity. Settings last,
 * where settings always are.
 *
 * "Irrigation Data" and "MQTT logins" are gone as top-level entries. They
 * were never destinations in their own right - irrigation data is part of
 * Reports, and MQTT logins are part of looking after kits. Both still have
 * their routes (see PAGES and REDIRECTS below), so no old link breaks. */
export const NAV: NavItem[] = [
  { id: "dashboard", label: "Home", icon: Icon.layoutDashboard },
  { id: "requests", label: "Requests", icon: Icon.inbox },
  { id: "users", label: "Farmers", icon: Icon.users },
  { id: "farms", label: "Farms & zones", icon: Icon.tractor },
  { id: "hardware", label: "Kits", icon: Icon.radio },
  { id: "alerts", label: "Alerts", icon: Icon.bell },
  { id: "maintenance", label: "Maintenance", icon: Icon.wrench },
  { id: "reports", label: "Reports", icon: Icon.barChart },
  { id: "activity", label: "Activity", icon: Icon.activity },
  { id: "settings", label: "Settings", icon: Icon.settings },
];

/* Old route -> where it lives now.
 *
 * Bookmarks, the browser's back button and any link written down in a
 * handover note all still work: go() sends them on rather than falling back
 * to the dashboard, which would silently lose the admin's place. */
const REDIRECTS: Record<string, PageId> = {
  // Irrigation data is a Reports concern - it is the same data the water
  // usage report is built from.
  irrigation: "reports",
};

const PAGES: Record<PageId, PageRenderer> = {
  dashboard: () => dashboardPage(),
  users: () => usersPage(),
  onboarding: () => onboardingPage(),
  requests: () => requestsPage(),
  farms: () => farmsPage(),
  hardware: () => hardwarePage(),
  // Reached from a button on the Hardware page rather than the sidebar, the
  // same way `requests` and `onboarding` are: it is a once-a-batch
  // administrative chore, not a place anyone needs to be one click from.
  mqttLogins: () => mqttLoginsPage(),
  alerts: () => alertsPage(),
  maintenance: () => maintenancePage(),
  reports: () => reportsPage(),
  irrigation: () => irrigationPage(),
  activity: () => activityPage(),
  settings: () => settingsPage(),
};

export interface AppState {
  activePage: PageId;
  pageOptions: PageOptions;
}

export const appState: AppState = { activePage: "dashboard", pageOptions: {} };

const isPageId = (v: string): v is PageId =>
  Object.prototype.hasOwnProperty.call(PAGES, v);

let afterRender: (() => void) | null = null;
export function setAfterRender(fn: () => void): void {
  afterRender = fn;
}

export async function go(pageId: string, opts: PageOptions = {}): Promise<void> {
  // An old route is forwarded, not dropped. Falling through to the
  // dashboard would lose the admin's place without telling them why.
  const redirected = REDIRECTS[pageId];
  if (redirected) {
    location.hash = redirected;
    return;
  }

  const id: PageId = isPageId(pageId) ? pageId : "dashboard";
  appState.activePage = id;
  appState.pageOptions = opts;

  const content = document.getElementById("content");
  const title = document.getElementById("headerTitle");
  if (!content) return;

  content.innerHTML = skeletonPage();

  const html = await PAGES[id](opts);
  await swapContent(content, html);

  // Pages reachable by link but not in the sidebar still need a header.
  const OFF_NAV_TITLES: Partial<Record<PageId, string>> = {
    onboarding: "Set up a farmer",
    mqttLogins: "MQTT logins",
  };

  if (title) {
    title.textContent =
      NAV.find((n) => n.id === id)?.label ?? OFF_NAV_TITLES[id] ?? "Home";
  }

  document.querySelectorAll<HTMLButtonElement>("#nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset["page"] === id);
  });

  if (location.hash !== `#${id}`) location.hash = id;

  animateIn(content);
  afterRender?.();

  if (id === "settings") {
    renderSettingsTab("General");
    positionTabUnderline();
  }
}

/** Re-renders the current page in place (used after filter changes). */
export async function refresh(): Promise<void> {
  await go(appState.activePage, appState.pageOptions);
}

export function renderSettingsTab(tab: string): void {
  const body = document.getElementById("settingsTabBody");
  if (!body) return;
  const safe: SettingsTab = (SETTINGS_TABS as string[]).includes(tab)
    ? (tab as SettingsTab)
    : "General";
  body.innerHTML = settingsTabBody(safe);
  body.classList.remove("tab-in");
  requestAnimationFrame(() => body.classList.add("tab-in"));
  animateIn(body);
  afterRender?.();
}

export function positionTabUnderline(): void {
  const active = document.querySelector<HTMLElement>(".tab.active");
  const underline = document.getElementById("tabUnderline");
  if (!active || !underline) return;
  underline.style.width = `${active.offsetWidth}px`;
  underline.style.transform = `translateX(${active.offsetLeft}px)`;
}

export function initNav(): void {
  const nav = document.getElementById("nav");
  if (!nav) return;
  nav.innerHTML = NAV.map(
    (n) => `<button data-page="${esc(n.id)}"><span class="nav-ico">${n.icon}</span>${esc(n.label)}</button>`,
  ).join("");
  nav.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (btn?.dataset["page"]) void go(btn.dataset["page"]);
  });
}

let hashListenerBound = false;

// Idempotent: main.ts's startAppShell() can now run more than once per
// page life (sign-out unmounts the shell, a later sign-in remounts and
// re-boots it - see app/shell.ts), but `window` itself is never torn down
// in between, so a second, unguarded addEventListener here would leave two
// listeners both calling go() on every future hash change.
export function bootRouter(): void {
  const fromHash = (): void => {
    const raw = (location.hash || "#dashboard").replace(/^#/, "") || "dashboard";
    void go(raw);
  };
  if (!hashListenerBound) {
    hashListenerBound = true;
    window.addEventListener("hashchange", fromHash);
  }
  fromHash();
}
