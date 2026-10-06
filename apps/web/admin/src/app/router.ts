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
import { errorState } from "@/ui/patterns";
import { animateIn, swapContent } from "@/lib/animate";
import { beginNavigation, isCurrentNavigation, endNavigation } from "@/lib/navigation";
import { beginPanelIntent, closeDrawer } from "@/lib/drawer";
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

/* Renders a page. Called ONLY by the hashchange listener (bootRouter) and by
 * refresh() - never by a click handler directly. See navigate() below.
 *
 * THE TWO RULES THAT FIX ITEM 0b
 *
 * 1. A NAVIGATION THAT HAS BEEN SUPERSEDED STOPS. Every await below is
 *    followed by a check that this is still the newest navigation. A page
 *    that answers after the admin has already clicked elsewhere is dropped,
 *    not painted over the page they moved to. Its outstanding reads are
 *    cancelled too (lib/navigation.ts).
 *
 * 2. RENDERING NEVER WRITES location.hash. Only a deliberate navigation does
 *    (navigate(), the address bar, back/forward). This was the loop: a stale
 *    page finished, wrote its own hash, which fired hashchange, which started
 *    a navigation to a page nobody wanted - eight clicks produced seventy-five
 *    hash changes in the test that found it. Where the address needs
 *    correcting (a redirect, an unknown page), history.replaceState does it
 *    without firing anything. */
export async function go(pageId: string, opts: PageOptions = {}): Promise<void> {
  // An old route is forwarded, not dropped. Falling through to the
  // dashboard would lose the admin's place without telling them why.
  const redirected = REDIRECTS[pageId];
  if (redirected) {
    history.replaceState(null, "", `#${redirected}`);
    return go(redirected, opts);
  }

  const id: PageId = isPageId(pageId) ? pageId : "dashboard";
  if (id !== pageId) history.replaceState(null, "", `#${id}`);

  const token = beginNavigation();

  // A panel still loading from the page being LEFT must not open on top of
  // the page being arrived at. Only on a real change of page: refresh()
  // re-renders the same page after an action, and must leave alone whatever
  // the admin has open on it.
  if (id !== appState.activePage) {
    beginPanelIntent();
    closeDrawer();
  }

  appState.activePage = id;
  appState.pageOptions = opts;

  const content = document.getElementById("content");
  const title = document.getElementById("headerTitle");
  if (!content) return;

  // The sidebar and the title change on the click, not when the page
  // arrives. Feedback that waits for the network reads as a missed click,
  // and a missed click is what makes people click again.
  setNavigationChrome(id, title);

  content.setAttribute("aria-busy", "true");
  content.innerHTML = skeletonPage();

  /* A page that throws gets an error state with a Retry, never an endless
     skeleton - and never a content area left marked busy, which would make
     it unclickable. Most pages already catch their own failures through
     withErrorState; this is for the ones that do not. */
  let html: string;
  try {
    html = await PAGES[id](opts);
  } catch (error) {
    if (!isCurrentNavigation(token)) return;
    console.error(`[admin] ${id} failed to render:`, error);
    html = errorState({
      title: "This page could not be loaded",
      detail: error instanceof Error ? error.message : "The server did not answer. Check your connection and try again.",
    });
  }
  if (!isCurrentNavigation(token)) return;

  await swapContent(content, html, () => isCurrentNavigation(token));
  if (!isCurrentNavigation(token)) return;

  content.removeAttribute("aria-busy");

  // For tests and for anyone debugging a report: which page is actually on
  // screen, as opposed to which one was last asked for.
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

/** A deliberate navigation: a click, a button, a link.
 *
 * It only changes the hash. The hashchange listener does the rendering, so
 * there is exactly one path into go() for a user's navigation - two paths is
 * how every click used to render twice.
 *
 * Asking for the page you are already on does nothing. It used to re-render
 * it, and five clicks on the current item produced ten content swaps. */
export function navigate(pageId: string): void {
  if (location.hash === `#${pageId}`) return;
  location.hash = pageId;
}

/** Go to a page AND show its current filters, even if it is the page you are
 *  already on. For the "Needs attention" cards and their like, which set a
 *  filter and then navigate: navigate() alone does nothing on the current
 *  page, so the new filter would be set and never shown. */
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

  // Two of the three tabs have a panel that needs the network, and a tab
  // body is a synchronous string. Router-level rather than inside
  // settingsTabBody so the page stays a pure function of its inputs.
  settingsTabLoader?.(safe);
}

/* Set by app/interactions.ts at startup. Here rather than imported because
   router already imports the pages, and the pages import interactions - a
   direct import would close that loop. */
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
  // One delegated listener on the nav, for every button in it. The nav
  // element is created fresh with each signed-in shell (app/shell.ts), so
  // this cannot accumulate across sign-ins.
  nav.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (btn?.dataset["page"]) navigate(btn.dataset["page"]);
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
