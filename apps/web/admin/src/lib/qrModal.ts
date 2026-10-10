import QRCode from "qrcode";
import { esc, fmtDate } from "@/lib/format";

/* Shows a Telegram link as a QR code plus the plain link, for following up a farmer who
 * never connected. The QR is for a farmer standing in front of the admin; the plain link is
 * for reading out over the phone or pasting into a WhatsApp message. */

let qrModalHost: HTMLElement | null = null;

function ensureQrModal(): HTMLElement {
  if (qrModalHost) {
    return qrModalHost;
  }

  const existing = document.getElementById("qrModal");

  if (existing) {
    qrModalHost = existing;
    return existing;
  }

  const modal = document.createElement("div");

  modal.id = "qrModal";
  modal.className = "error-modal qr-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "qrModalTitle");

  modal.innerHTML = `
    <div class="error-modal-backdrop"></div>

    <div class="error-modal-panel">
      <div class="error-modal-content">
        <h2 id="qrModalTitle">Connect Telegram</h2>
        <p id="qrModalMessage"></p>

        <canvas id="qrModalCanvas" width="240" height="240"></canvas>

        <p class="qr-modal-link">
          <a id="qrModalLink" href="#" target="_blank" rel="noreferrer"></a>
        </p>

        <p class="qr-modal-expiry" id="qrModalExpiry"></p>

        <p class="onboarding-warning">
          This only connects their Telegram. It does not change their password
          or their sign-in details.
        </p>
      </div>

      <button type="button" class="error-modal-close" id="qrModalClose">
        Done
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.classList.remove("open");

  modal.querySelector(".error-modal-backdrop")?.addEventListener("click", close);
  modal.querySelector("#qrModalClose")?.addEventListener("click", close);

  qrModalHost = modal;

  return modal;
}

export function showQrModal(
  farmerName: string,
  deepLink: string | null,
  expiresAt: string,
): void {
  const modal = ensureQrModal();

  const message = modal.querySelector<HTMLElement>("#qrModalMessage");
  const canvas = modal.querySelector<HTMLCanvasElement>("#qrModalCanvas");
  const link = modal.querySelector<HTMLAnchorElement>("#qrModalLink");
  const expiry = modal.querySelector<HTMLElement>("#qrModalExpiry");

  if (message) {
    message.innerHTML =
      `Have <strong>${esc(farmerName)}</strong> scan this, or send them the link. ` +
      `Pressing Start in Telegram is what connects them.`;
  }

  if (expiry) {
    expiry.textContent = `This link stops working on ${fmtDate(expiresAt)}.`;
  }

  if (link) {
    if (deepLink) {
      link.href = deepLink;
      link.textContent = deepLink;
    } else {
      link.removeAttribute("href");
      link.textContent = "Telegram is not configured on the server.";
    }
  }

  if (canvas) {
    if (deepLink) {
      canvas.style.display = "";

      /* A QR that will not draw is not a failure: the link text above it still works. */
      void QRCode.toCanvas(canvas, deepLink, { width: 240, margin: 1 })
        .catch(() => {
          canvas.style.display = "none";
        });
    } else {
      canvas.style.display = "none";
    }
  }

  modal.classList.add("open");

  window.setTimeout(() => {
    modal.querySelector<HTMLButtonElement>("#qrModalClose")?.focus();
  }, 0);
}
