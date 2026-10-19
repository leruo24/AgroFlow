/* A confirm step that says the consequence in plain words, for actions that change a farmer's
 * account (remove an account, disconnect Telegram). A real dialog instead of window.confirm,
 * so the wording can be styled, tested and read by a screen reader. One at a time: opening a
 * second answers the first with "Cancel". */

import { esc } from "@/lib/format";

export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};

let closeOpen: ((answer: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  closeOpen?.(false);

  return new Promise<boolean>((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const host = document.createElement("div");
    host.className = "confirm-dialog";
    host.setAttribute("role", "alertdialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-labelledby", "confirmDialogTitle");
    host.setAttribute("aria-describedby", "confirmDialogBody");
    host.innerHTML = `
      <div class="confirm-dialog-backdrop" data-confirm-cancel></div>
      <div class="confirm-dialog-panel">
        <h2 id="confirmDialogTitle">${esc(opts.title)}</h2>
        <p id="confirmDialogBody">${esc(opts.body)}</p>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn ghost" data-confirm-cancel>${esc(opts.cancelLabel ?? "Cancel")}</button>
          <button type="button" class="btn${opts.danger ? " danger" : ""}" data-confirm-ok>${esc(opts.confirmLabel)}</button>
        </div>
      </div>`;

    const finish = (answer: boolean): void => {
      if (closeOpen !== finish) return;
      closeOpen = null;
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      previousFocus?.focus?.();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      }
    };

    closeOpen = finish;
    host.querySelectorAll("[data-confirm-cancel]").forEach((el) => el.addEventListener("click", () => finish(false)));
    host.querySelector("[data-confirm-ok]")?.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(host);
    // Cancel has focus first, so Enter on a stray key press does not remove an account.
    host.querySelector<HTMLButtonElement>("[data-confirm-cancel].btn")?.focus();
  });
}
