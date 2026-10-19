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
import { skeletonPage, watchSlowLoading } from "@/ui/components";
import { errorState } from "@/ui/patterns";
import { animateIn, swapContent } from "@/lib/animate";
import { beginNavigation, isCurrentNavigation, endNavigation } from "@/lib/navigation";
import { beginPanelIntent, closeDrawer } from "@/lib/drawer";
import { esc } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { plainError } from "@/lib/plainError";

/* The sidebar, in the order an admin works: Home (the queue), Requests (incoming work),
 * then farmers, farms and zones, kits, then alerts and maintenance, reports, activity and
 * Settings last. Irrigation data and MQTT logins are not in the sidebar but keep their
 * routes (see PAGES and REDIRECTS), so old links still work. */
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

/* Old route -> where it lives. Bookmarks, the back button and links in handover notes keep
 * working: go() forwards them instead of dropping the admin on the dashboard. */
const REDIRECTS: Record<string, PageId> = {
  // Irrigation data belongs to Reports: it is the same data the water usage report uses.
  irrigation: "reports",
};

const PAGES: Record<PageId, PageRenderer> = {
  dashboard: () => dashboardPage(),
  users: () => usersPage(),
  onboarding: () => onboardingPage(),
  requests: () => requestsPage(),
  farms: () => farmsPage(),
  hardware: () => hardwarePage(),
  // Opened from a button on the Hardware page, like `requests` and `onboarding`: it is a
  // once-a-batch admin job.
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

/* Renders a page. Called only by the hashchange listener (bootRouter) and refresh(), never
 * by a click handler; see navigate() below. Two rules:
 * 1. A navigation that has been replaced stops. After every await we check this is still
 * the newest navigation, and its outstanding reads are cancelled (lib/navigation.ts).
 * 2. Rendering never writes location.hash, which would fire hashchange and start another
 * navigation. Where the address needs correcting, history.replaceState does it quietly. */
export async function go(pageId: string, opts: PageOptions = {}): Promise<void> {
  // An old route is forwarded, not dropped, so the admin does not lose their place.
  const redirected = REDIRECTS[pageId];
  if (redirected) {
    history.replaceState(null, "", `#${redirected}`);
    return go(redirected, opts);
  }

  const id: PageId = isPageId(pageId) ? pageId : "dashboard";
  if (id !== pageId) history.replaceState(null, "", `#${id}`);

  const token = beginNavigation();

  // A panel still loading from the page being left must not open on the new page. Only on a
  // real page change: refresh() re-renders the same page and must leave open panels alone.
  if (id !== appState.activePage) {
    beginPanelIntent();
    closeDrawer();
  }

  appState.activePage = id;
  appState.pageOptions = opts;

  const content = document.getElementById("content");
  const title = document.getElementById("headerTitle");
  if (!content) return;

  // The sidebar and title change on the click, not when the page arrives, so the click
  // never looks missed.
  setNavigationChrome(id, title);

  content.setAttribute("aria-busy", "true");
  content.innerHTML = skeletonPage();
  watchSlowLoading(content);

  /* A page that throws gets an error state with a Retry, never an endless skeleton or a
   * content area left busy (unclickable). Most pages catch their own failures through
   * withErrorState; this is for the rest. */
  let html: string;
  try {
    html = await PAGES[id](opts);
  } catch (error) {
    if (!isCurrentNavigation(token)) return;
    console.error(`[admin] ${id} failed to render:`, error);
    html = errorState({
      title: "This page could not be loaded",
      detail: plainError(error, "The server did not answer. Check your connection and try again."),
    });
  }
  if (!isCurrentNavigation(token)) return;

  await swapContent(content, html, () => isCurrentNavigation(token));
  if (!isCurrentNavigation(token)) return;

  content.removeAttribute("aria-busy");

  // For tests and debugging: which page is on screen, not which was last asked for.
  content.dataset["page"] = id;

  endNavigation(token);

  animateIn(content);
  afterRender?.();

  if (id === "settings") {
    renderSettingsTab("My account");
    positionTabUnderline();
  }
}

// Pages reachable by link but not in the sidebar still need a header.
const OFF_NAV_TITLES: Partial<Record<PageId, string>> = {
  onboarding: "Set up a farmer",
  mqttLogins: "MQTT logins",
};

function setNavigationChrome(id: PageId, title: HTMLElement | null): void {
  if (title) {
    title.textContent = NAV.find((n) => n.id === id)?.label ?? OFF_NAV_TITLES[id] ?? "Home";
  }

  document.querySelectorAll<HTMLButtonElement>("#nav button").forEach((b) => {
    const active = b.dataset["page"] === id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

/**
 * A navigation from a click, button or link. It only changes the hash; the hashchange
 * listener renders, so there is one path into go(). Asking for the current page does nothing.
 */
export function navigate(pageId: string): void {
  if (location.hash === `#${pageId}`) return;
  location.hash = pageId;
}

/**
 * Go to a page and show its current filters, even if it is the current page. For the
 * "Needs attention" cards, which set a filter then navigate: navigate() alone does nothing
 * on the current page.
 */
export function showPage(pageId: string): void {
  if (location.hash === `#${pageId}`) void refresh();
  else navigate(pageId);
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
    : "My account";
  body.innerHTML = settingsTabBody(safe);
  body.classList.remove("tab-in");
  requestAnimationFrame(() => body.classList.add("tab-in"));
  animateIn(body);
  afterRender?.();

  // Two of the three tabs have a panel that needs the network, and a tab body is a plain
  // string. Done here so settingsTabBody stays a pure function of its inputs.
  settingsTabLoader?.(safe);
}

/* Set by app/interactions.ts at startup. Not imported, because router imports the pages and
 * the pages import interactions, which would make a loop. */
let settingsTabLoader: ((tab: SettingsTab) => void) | null = null;

export function onSettingsTabRendered(fn: (tab: SettingsTab) => void): void {
  settingsTabLoader = fn;
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
  // One delegated listener on the nav for every button in it. The nav is created new with
  // each signed-in shell (app/shell.ts), so listeners cannot pile up across sign-ins.
  nav.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (btn?.dataset["page"]) navigate(btn.dataset["page"]);
  });
}

let hashListenerBound = false;

// Safe to call more than once: startAppShell() runs again after sign-out and sign-in (see
// app/shell.ts), but `window` stays, so without the guard two listeners would call go() on
// every hash change.
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
