/* The signed-in app shell's markup: sidebar, header and content section. One of the three
 * states main.ts's render() puts into #root (see ViewState/renderState()), as a plain HTML
 * string that main.ts wires up after inserting it. */

import { Icon } from "@/lib/icons";
import { brandHtml } from "@/ui/brand";
import { appearanceHtml } from "@/ui/appearance";
import { text as t } from "@/pages/publicCopy";

export const SHELL_HTML = `
  <div class="app" id="appShell">
    <aside class="sidebar" id="sidebar">
      <button class="sidebar-close" id="sidebarClose" type="button" aria-label="Close navigation">${Icon.x}</button>
      <!-- The logo and name go Home (admin polish, item 3). -->
      <a class="brand" id="brandHome" href="#dashboard" aria-label="AgroFlow Staff - go to Overview">
        <!-- Relative path: the site is served from a sub-path on GitHub
             Pages, not a domain root. alt is empty because the wordmark
             beside it already says "AgroFlow" - a screen reader should not
             hear the name twice. -->
        ${brandHtml("visual-brand", t("staff"))}
      </a>
      <nav class="nav" id="nav"></nav>
      <!-- Driven by GET /api/admin/health, refreshed every 60 s (see
           app/health.ts). Starts as "Checking…" rather than an assumed
           state: claiming everything is fine before anything has been
           checked is worse than saying nothing. Clicking it opens the
           System health card on Home. -->
      <button class="side-foot" id="platformStatus" data-act="open-health" type="button">
        <b>Platform status</b>
        <span class="side-foot-state" id="platformStatusText">
          <i class="dot dot-unknown"></i>Checking…
        </span>
      </button>
      <div class="side-account" aria-label="Account">
        <a class="side-account-link" href="#settings">Profile</a>
        <button class="side-account-link" id="sidebarNotifications" type="button">Notifications</button>
        <button class="side-logout" data-logout type="button">Log out</button>
      </div>
    </aside>
    <button class="sidebar-scrim" id="sidebarScrim" type="button" aria-label="Close navigation" tabindex="-1"></button>

    <div class="main">
      <header class="header">
        <div class="header-l">
          <button class="sidebar-toggle" id="sidebarToggle" aria-label="Toggle navigation">${Icon.menu}</button>
          <h2 id="headerTitle">Dashboard</h2>
        </div>
        <div class="header-r">
          <input id="headerSearch" class="search" type="text" placeholder="Search this page…" />
          <div class="status-chip status-chip-unknown" id="headerStatusChip">Checking…</div>
          <!-- Staff notices live here, not on Telegram (app/bell.ts). -->
          <button id="bellBtn" class="bell" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
            ${Icon.bell}<span id="bellCount" class="bell-count" hidden></span>
          </button>
          <div id="bellMenu" class="menu bell-menu" role="menu"></div>
          <button id="avatarBtn" class="avatar" title="Account menu" aria-label="Account menu">··</button>
          <div id="avatarMenu" class="menu">
            <div class="menu-head">
              <b>—</b>
              <span>Platform Administrator</span>
            </div>
            <a href="#settings">Profile</a>
            <a href="#" data-act="open-change-password">Change password</a>
            <a href="#settings">Settings</a>
            ${appearanceHtml()}
            <button id="logoutBtn" data-logout type="button">Log out</button>
          </div>
        </div>
      </header>

      <section id="content" class="content"></section>
    </div>
  </div>`;
