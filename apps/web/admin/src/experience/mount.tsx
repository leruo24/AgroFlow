import { createRoot, type Root } from "react-dom/client";
import { ExperienceAgroFlow } from "./components/ExperienceAgroFlow";
import "./experience.css";

let reactRoot: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountExperience(): void {
  if (reactRoot) return;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host = document.createElement("div");
  host.id = "experienceAgroFlowRoot";
  document.body.append(host);
  const close = () => {
    reactRoot?.unmount();
    reactRoot = null;
    host?.remove();
    host = null;
    previouslyFocused?.focus();
  };
  reactRoot = createRoot(host);
  reactRoot.render(<ExperienceAgroFlow onClose={close} />);
  window.setTimeout(() => host?.querySelector<HTMLButtonElement>(".experience-close")?.focus(), 0);
}

