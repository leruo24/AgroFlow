import { text as t } from "@/pages/publicCopy";
export type Appearance = "system" | "light" | "dark";
const KEY = "agroflow_appearance";
const system = window.matchMedia("(prefers-color-scheme: dark)");
let preference: Appearance = "system";
try {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") preference = saved;
} catch {
  /* Apply system appearance when storage is unavailable. */
}

function apply(): void {
  const resolved =
    preference === "system" ? (system.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelectorAll<HTMLButtonElement>("[data-appearance-choice]")
    .forEach((button) => {
      const active = button.dataset["appearanceChoice"] === preference;
      button.setAttribute("aria-pressed", String(active));
    });
  document
    .querySelectorAll<HTMLElement>("[data-appearance-status]")
    .forEach((status) => {
      const control = status.closest<HTMLElement>(".appearance-control");
      const active = control?.querySelector<HTMLButtonElement>(
        `[data-appearance-choice="${preference}"]`,
      );
      status.textContent =
        active?.getAttribute("aria-label") ?? active?.dataset["appearanceLabel"] ?? preference;
    });
}
system.addEventListener("change", apply);
apply();

const sun = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const systemIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const rain = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C10 7 5 11 5 16a7 7 0 0 0 14 0c0-5-5-9-7-14Z"/><path d="M9 17c.6 1.2 1.6 1.8 3 1.8"/></svg>`;

export function appearanceHtml(
  labels: readonly [string, string, string, string] = [
    t("theme"),
    t("system"),
    t("light"),
    t("dark"),
  ],
): string {
  const option = (value: Appearance, label: string, icon: string) =>
    `<button type="button" data-appearance-choice="${value}" data-appearance-label="${label}" aria-label="${labels[0]}: ${label}" title="${label}" aria-pressed="false">${icon}<span>${label}</span></button>`;
  return `<fieldset class="appearance-control"><legend>${labels[0]}</legend><div class="appearance-options" role="group" aria-label="${labels[0]}">${option("light", labels[2], sun)}${option("system", labels[1], systemIcon)}${option("dark", labels[3], rain)}</div><span class="sr-only" role="status" aria-live="polite" data-appearance-status></span></fieldset>`;
}
export function wireAppearance(root: ParentNode): void {
  apply();
  root
    .querySelectorAll<HTMLButtonElement>("[data-appearance-choice]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        preference = button.dataset["appearanceChoice"] as Appearance;
        try {
          localStorage.setItem(KEY, preference);
        } catch {
          /* Session-only preference. */
        }
        apply();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const options = [
          ...(button
            .closest(".appearance-options")
            ?.querySelectorAll<HTMLButtonElement>("[data-appearance-choice]") ?? []),
        ];
        const current = options.indexOf(button);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + options.length) %
                options.length;
        options[next]?.focus();
        options[next]?.click();
      });
    });
}
