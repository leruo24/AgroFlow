/* Typed hash router with animated page transitions. */

import type { NavItem, PageId, PageOptions, PageRenderer, SettingsTab } from "@/types/models";
import { dashboardPage } from "@/pages/dashboard";
import { usersPage } from "@/pages/users";
import { farmsPage } from "@/pages/farms";
import { onboardingPage } from "@/pages/onboarding";
import { hardwarePage, alertsPage, maintenancePage } from "@/pages/operations";
import {
  irrigationPage, reportsPage, activityPage, settingsPage, settingsTabBody, SETTINGS_TABS,
} from "@/pages/analytics";
import { skeletonPage } from "@/ui/components";
import { animateIn, swapContent } from "@/lib/animate";
import { esc } from "@/lib/format";

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "users", label: "Users", icon: "👥" },
  { id: "farms", label: "Farms", icon: "🚜" },
  { id: "hardware", label: "Farm Hardware", icon: "📡" },
  { id: "alerts", label: "Alerts", icon: "🚨" },
  { id: "maintenance", label: "Maintenance", icon: "🛠️" },
  { id: "reports", label: "Reports & Analytics", icon: "📈" },
  { id: "irrigation", label: "Irrigation Data", icon: "💧" },
  { id: "activity", label: "Platform Activity", icon: "📜" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

const PAGES: Record<PageId, PageRenderer> = {
  dashboard: () => dashboardPage(),
  users: () => usersPage(),
  onboarding: () => onboardingPage(),
  farms: () => farmsPage(),
  hardware: () => hardwarePage(),
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
  const id: PageId = isPageId(pageId) ? pageId : "dashboard";
  appState.activePage = id;
  appState.pageOptions = opts;

  const content = document.getElementById("content");
  const title = document.getElementById("headerTitle");
  if (!content) return;

  content.innerHTML = skeletonPage();

  const html = await PAGES[id](opts);
  await swapContent(content, html);

  if (title) title.textContent = NAV.find((n) => n.id === id)?.label ?? "Dashboard";

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

export function bootRouter(): void {
  const fromHash = (): void => {
    const raw = (location.hash || "#dashboard").replace(/^#/, "") || "dashboard";
    void go(raw);
  };
  window.addEventListener("hashchange", fromHash);
  fromHash();
}
