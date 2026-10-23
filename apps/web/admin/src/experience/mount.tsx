import { createRoot, type Root } from "react-dom/client";
import { ExperienceAgroFlow } from "./components/ExperienceAgroFlow";
import "./experience.css";

let reactRoot: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountExperience(returnFocus?: HTMLElement): void {
  if (reactRoot) return;
  const previouslyFocused = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  host = document.createElement("div");
  host.id = "experienceAgroFlowRoot";
  host.addEventListener("keydown", event => {
    if (event.key !== "Tab" || !host) return;
    const controls = [...host.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length > 0);
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  });
  document.body.append(host);
  const close = () => {
    window.removeEventListener("hashchange", close);
    reactRoot?.unmount();
    reactRoot = null;
    host?.remove();
    host = null;
    previouslyFocused?.focus();
  };
  // The demo sits on <body>, outside the page the router swaps, so leaving the landing page
  // (the back button, or a link to #/login) must close it too.
  window.addEventListener("hashchange", close);
  reactRoot = createRoot(host);
  reactRoot.render(<ExperienceAgroFlow onClose={close} />);
  window.setTimeout(() => host?.querySelector<HTMLButtonElement>(".experience-close")?.focus(), 0);
}

