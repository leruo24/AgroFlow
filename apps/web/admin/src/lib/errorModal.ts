let errorModalHost: HTMLElement | null = null;

function ensureErrorModal(): HTMLElement {
  if (errorModalHost) {
    return errorModalHost;
  }

  const existing = document.getElementById("errorModal");

  if (existing) {
    errorModalHost = existing;
    return existing;
  }

  const modal = document.createElement("div");

  modal.id = "errorModal";
  modal.className = "error-modal";
  modal.setAttribute("role", "alertdialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "errorModalTitle");

  modal.innerHTML = `
    <div class="error-modal-backdrop"></div>

    <div class="error-modal-panel">
      <div class="error-modal-icon" aria-hidden="true">!</div>

      <div class="error-modal-content">
        <h2 id="errorModalTitle">Something went wrong</h2>
        <p id="errorModalMessage"></p>
      </div>

      <button
        type="button"
        class="error-modal-close"
        id="errorModalClose"
      >
        OK
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => {
    modal.classList.remove("open");
  };

  modal
    .querySelector(".error-modal-backdrop")
    ?.addEventListener("click", close);

  modal
    .querySelector("#errorModalClose")
    ?.addEventListener("click", close);

  errorModalHost = modal;

  return modal;
}

export function showErrorModal(
  message: string,
  title = "Something went wrong",
): void {
  const modal = ensureErrorModal();

  const titleElement =
    modal.querySelector<HTMLElement>("#errorModalTitle");

  const messageElement =
    modal.querySelector<HTMLElement>("#errorModalMessage");

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }

  modal.classList.add("open");

  window.setTimeout(() => {
    modal.querySelector<HTMLButtonElement>(
      "#errorModalClose",
    )?.focus();
  }, 0);
}
