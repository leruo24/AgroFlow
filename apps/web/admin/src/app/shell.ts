/* The authenticated app shell's markup - sidebar, header, content
   section. One of the three mutually exclusive states main.ts's
   render() puts into #root (see main.ts's ViewState/renderState()) - a
   plain HTML string, wired up by main.ts right after it's inserted.
   Holds no mount/unmount state itself; #root's own innerHTML is the only
   thing that determines whether this exists in the DOM at all. */

import { Icon } from "@/lib/icons";

export const SHELL_HTML = `
  <div class="app" id="appShell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="leaf">${Icon.sprout}</span>
        <div>
          <h1>AgroFlow</h1>
          <div class="sub">Administration</div>
        </div>
      </div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot">
        <b>Platform status</b>
        Monitoring not yet implemented
      </div>
    </aside>

    <div class="main">
      <header class="header">
        <div class="header-l">
          <button class="sidebar-toggle" id="sidebarToggle" aria-label="Toggle navigation">${Icon.menu}</button>
          <h2 id="headerTitle">Dashboard</h2>
        </div>
        <div class="header-r">
          <input id="headerSearch" class="search" type="text" placeholder="Search this page…" />
          <div class="status-chip status-chip-unknown">Monitoring not yet implemented</div>
          <button id="avatarBtn" class="avatar" title="Account menu" aria-label="Account menu">··</button>
          <div id="avatarMenu" class="menu">
            <div class="menu-head">
              <b>—</b>
              <span>Platform Administrator</span>
            </div>
            <a href="#settings">Profile</a>
            <a href="#settings">Settings</a>
            <button id="logoutBtn">Sign out</button>
          </div>
        </div>
      </header>

      <section id="content" class="content"></section>
    </div>
  </div>`;
