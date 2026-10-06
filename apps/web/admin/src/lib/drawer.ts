/* Slide-out drawer — detail views, edit forms and confirmations. */

declare global {
  interface Window {
    /* Set by app/interactions.ts at startup. Pickers rendered into a drawer
       need their click handlers attached after the drawer writes its HTML,
       and the drawer is the only thing that knows when that happened. */
    agroflowBindDrawerPickers?: () => void;
  }
}

import { Icon } from "@/lib/icons";

export interface DrawerField {
  label: string;
  value: string;
  editable?: boolean;
  name?: string;
}

export interface DrawerOptions {
  title: string;
  subtitle?: string;
  /** Simple label/value or editable fields. */
  fields?: DrawerField[];
  /** Pre-built HTML for rich detail views. Rendered after `fields`. */
  bodyHtml?: string;
  /** Wider panel for multi-section detail views. */
  wide?: boolean;
  confirmLabel?: string;
  onConfirm?: (values: Record<string, string>) => void;
  onOpen?: () => void;
  /** From currentPanelIntent(), taken BEFORE the opener's first await. If a
      newer panel was asked for in the meantime, this one is not opened. */
  intent?: number;
}

/* Which detail panel the admin asked for LAST.
 *
 * Opening a farm or a farmer reads from the network first. Click two rows
 * quickly and both reads are in flight; without this, whichever answered
 * last would open - not the one clicked last. Every "view-" click and every
 * page navigation takes a new intent; an opener that finds a newer one when
 * its data arrives quietly does nothing. */
let panelIntent = 0;

export function beginPanelIntent(): number {
  panelIntent += 1;
  return panelIntent;
}

export function currentPanelIntent(): number {
  return panelIntent;
}

function escapeText(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (m) => map[m] ?? m);
}

function ensureHost(): { overlay: HTMLElement; panel: HTMLElement } {
  let overlay = document.getElementById("drawerOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "drawerOverlay";
    overlay.className = "drawer-overlay";
    overlay.innerHTML = `<aside class="drawer" id="drawerPanel" role="dialog" aria-modal="true"></aside>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeDrawer();
    });
  }
  return { overlay, panel: document.getElementById("drawerPanel") as HTMLElement };
}

export function closeDrawer(): void {
  document.getElementById("drawerOverlay")?.classList.remove("open");
}

export function openDrawer(opts: DrawerOptions): void {
  if (opts.intent !== undefined && opts.intent !== panelIntent) return;

  const { overlay, panel } = ensureHost();
  panel.classList.toggle("wide", Boolean(opts.wide));

  const fieldsHtml = (opts.fields ?? [])
    .map((f) => {
      const name = f.name ?? f.label.toLowerCase().replace(/\s+/g, "_");
      if (f.editable) {
        return `<label class="drawer-field">
          <span>${escapeText(f.label)}</span>
          <input type="text" data-field="${escapeText(name)}" value="${escapeText(f.value)}" />
        </label>`;
      }
      return `<div class="drawer-field">
        <span>${escapeText(f.label)}</span>
        <div class="drawer-readonly">${escapeText(f.value)}</div>
      </div>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="drawer-head">
      <div>
        <h4>${escapeText(opts.title)}</h4>
        ${opts.subtitle ? `<p class="muted">${escapeText(opts.subtitle)}</p>` : ""}
      </div>
      <button class="drawer-x" data-drawer-close aria-label="Close">${Icon.x}</button>
    </div>
    <div class="drawer-body">
      ${fieldsHtml}
      ${opts.bodyHtml ?? ""}
    </div>
    <div class="drawer-foot">
      ${opts.confirmLabel ? `<button class="btn" data-drawer-confirm>${escapeText(opts.confirmLabel)}</button>` : ""}
      <button class="btn ghost" data-drawer-close>Close</button>
    </div>`;

  overlay.classList.add("open");

  // Any picker in a drawer is bound before the caller's own onOpen runs, so
  // a drawer that only needs a picker does not have to supply a hook. Set on
  // window rather than imported, because lib/ must not depend on app/.
  window.agroflowBindDrawerPickers?.();

  opts.onOpen?.();

  panel.querySelectorAll("[data-drawer-close]").forEach((b) =>
    b.addEventListener("click", () => closeDrawer()));

  panel.querySelector<HTMLButtonElement>("[data-drawer-confirm]")?.addEventListener("click", (e) => {
    // Once. A double-click used to call onConfirm twice before closeDrawer
    // had taken effect - two farms, two codes, two of whatever it creates.
    const button = e.currentTarget as HTMLButtonElement;
    if (button.disabled) return;
    button.disabled = true;

    const values: Record<string, string> = {};
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => {
  values[input.dataset["field"] ?? ""] = input.value;
});
    opts.onConfirm?.(values);
    closeDrawer();
  });

  window.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      closeDrawer();
      window.removeEventListener("keydown", onEsc);
    }
  });

  window.setTimeout(() => {
    panel.querySelector<HTMLInputElement>("input[data-field]")?.focus();
  }, 220);
}
