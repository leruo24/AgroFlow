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
  document.documentElement.dataset.theme =
    preference === "system" ? (system.matches ? "dark" : "light") : preference;
  document
    .querySelectorAll<HTMLSelectElement>("[data-appearance]")
    .forEach((el) => {
      el.value = preference;
    });
}
system.addEventListener("change", apply);
apply();

export function appearanceHtml(
  labels: readonly [string, string, string, string] = [
    t("theme"),
    t("system"),
    t("light"),
    t("dark"),
  ],
): string {
  return `<label class="appearance-control"><svg width="24" height="32" viewBox="0 0 32 40" aria-hidden="true" focusable="false"><path d="M16 2C14 9 3 19 3 25a13 13 0 0026 0C29 19 18 9 16 2Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="25" r="6" fill="currentColor"/></svg><span>${labels[0]}</span><select data-appearance aria-label="${labels[0]}"><option value="system">${labels[1]}</option><option value="light">${labels[2]}</option><option value="dark">${labels[3]}</option></select></label>`;
}
export function wireAppearance(root: ParentNode): void {
  apply();
  root.querySelectorAll<HTMLSelectElement>("[data-appearance]").forEach((el) =>
    el.addEventListener("change", () => {
      preference = el.value as Appearance;
      try {
        localStorage.setItem(KEY, preference);
      } catch {
        /* Session-only preference. */
      }
      apply();
    }),
  );
}
