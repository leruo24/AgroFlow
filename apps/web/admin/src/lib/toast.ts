/* Toast notifications — animated, auto-dismissing, stack in a corner. */

import { prefersReducedMotion } from "@/lib/animate";

export type ToastKind = "success" | "info" | "warn" | "error";

const ICONS: Record<ToastKind, string> = {
  success: "✅",
  info: "ℹ️",
  warn: "⚠️",
  error: "⛔",
};

function container(): HTMLElement {
  let el = document.getElementById("toastHost");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastHost";
    el.className = "toast-host";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

export function toast(message: string, kind: ToastKind = "info", ms = 3200): void {
  const host = container();
  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.innerHTML = `<span class="toast-ico">${ICONS[kind]}</span><span class="toast-msg"></span>`;
  // textContent avoids any HTML injection from message strings.
  const msgEl = node.querySelector<HTMLElement>(".toast-msg");
  if (msgEl) msgEl.textContent = message;

  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add("in"));

  const remove = (): void => {
    if (prefersReducedMotion()) {
      node.remove();
      return;
    }
    node.classList.remove("in");
    node.classList.add("out");
    window.setTimeout(() => node.remove(), 320);
  };

  const timer = window.setTimeout(remove, ms);
  node.addEventListener("click", () => {
    window.clearTimeout(timer);
    remove();
  });
}
