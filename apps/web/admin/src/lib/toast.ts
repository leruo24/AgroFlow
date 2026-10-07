/* Toast notifications — animated, auto-dismissing, stack in a corner. */

import { prefersReducedMotion } from "@/lib/animate";
import { Icon } from "@/lib/icons";

export type ToastKind = "success" | "info" | "warn" | "error";

const ICONS: Record<ToastKind, string> = {
  success: Icon.circleCheck,
  info: Icon.info,
  warn: Icon.triangleAlert,
  error: Icon.circleX,
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

/* Admin polish: a toast with one action - "Undo" for 5 s after a dismiss.
   The action runs at most once; the toast closes when it is pressed. */
export function toastWithUndo(message: string, onUndo: () => void, ms = 5000): void {
  const host = container();
  const node = document.createElement("div");
  node.className = "toast toast-info toast-undo";
  node.innerHTML = `<span class="toast-ico">${ICONS.info}</span><span class="toast-msg"></span>` +
    `<button type="button" class="toast-action" data-toast-undo>Undo</button>`;
  const msgEl = node.querySelector<HTMLElement>(".toast-msg");
  if (msgEl) msgEl.textContent = message;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add("in"));

  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    node.classList.remove("in");
    node.classList.add("out");
    window.setTimeout(() => node.remove(), prefersReducedMotion() ? 0 : 320);
  };
  const timer = window.setTimeout(remove, ms);
  node.querySelector<HTMLButtonElement>("[data-toast-undo]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (done) return;
    window.clearTimeout(timer);
    remove();
    onUndo();
  });
}
