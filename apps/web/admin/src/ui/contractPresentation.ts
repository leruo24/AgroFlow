import { text as t } from "@/pages/publicCopy";
// Exact server phases from ui-contracts.md at audit branch commit 6fa2cff.
export const COMMAND_PHASES = [
  "request_sent",
  "waiting_for_kit",
  "kit_confirmed_start",
  "finished",
  "stop_requested",
  "kit_confirmed_stop",
  "no_response",
  "failed",
] as const;
export function commandPhaseCatalogueHtml(): string {
  return `<section class="visual-grid" aria-label="${t("catalogue")}">${COMMAND_PHASES.map((phase) => `<article class="visual-card" data-command-phase="${phase}"><h2>${t(`phase.${phase}`)}</h2><p>${t("catalogue")}</p></article>`).join("")}</section>`;
}
