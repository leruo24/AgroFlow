/* ============================================================================
   Animation utilities.
   All motion respects prefers-reduced-motion: when the user has it enabled,
   animations resolve instantly to their final state instead of being skipped
   entirely (so nothing is ever left blank or mid-transition).
   ========================================================================== */

export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** easeOutCubic — fast start, gentle settle. */
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Animates a number from 0 → target inside an element.
 * The element supplies target/format via data attributes:
 *   data-countup="1234"  data-countup-format="int|pct|litres"
 */
export function countUp(
  el: HTMLElement,
  target: number,
  format: (n: number) => string,
  duration = 900,
): void {
  if (prefersReducedMotion()) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = format(target * easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = format(target);
  };
  requestAnimationFrame(step);
}

/** Runs count-up on every [data-countup] element within a root. */
export function runCountUps(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-countup]").forEach((el) => {
    const target = Number(el.dataset["countup"] ?? 0);
    const kind = el.dataset["countupFormat"] ?? "int";
    const format = (n: number): string => {
      if (kind === "pct") return `${n.toFixed(1)}%`;
      if (kind === "litres") return `${Math.round(n).toLocaleString("en-ZA")} L`;
      if (kind === "ratio") {
        const total = el.dataset["countupTotal"] ?? "";
        return `${Math.round(n).toLocaleString("en-ZA")} / ${total}`;
      }
      return Math.round(n).toLocaleString("en-ZA");
    };
    countUp(el, target, format);
  });
}

/**
 * Grows bar-chart columns from zero to their final height.
 * Bars carry their target height in data-h (percentage).
 */
export function growBars(root: ParentNode = document): void {
  const bars = root.querySelectorAll<HTMLElement>(".bar[data-h]");
  bars.forEach((bar, i) => {
    const target = bar.dataset["h"] ?? "0";
    if (prefersReducedMotion()) {
      bar.style.height = `${target}%`;
      return;
    }
    bar.style.height = "0%";
    window.setTimeout(() => {
      bar.style.height = `${target}%`;
    }, 60 + i * 55);
  });
}

/**
 * Draws donut arcs by animating stroke-dashoffset from full to zero.
 * Each arc stores its dash length in data-len.
 */
export function drawDonuts(root: ParentNode = document): void {
  root.querySelectorAll<SVGCircleElement>("circle[data-len]").forEach((arc, i) => {
    const len = Number(arc.dataset["len"] ?? 0);
    if (prefersReducedMotion()) {
      arc.style.strokeDashoffset = "0";
      return;
    }
    arc.style.strokeDashoffset = String(len);
    window.setTimeout(() => {
      arc.style.transition = "stroke-dashoffset 900ms cubic-bezier(.22,.9,.31,1)";
      arc.style.strokeDashoffset = "0";
    }, 80 + i * 120);
  });
}

/**
 * Staggered entrance for cards, panels and table rows.
 * Elements start with .reveal (opacity 0, translateY) and get .in added.
 */
export function revealStagger(root: ParentNode = document, stepMs = 45): void {
  const items = root.querySelectorAll<HTMLElement>(".reveal:not(.in)");
  items.forEach((el, i) => {
    if (prefersReducedMotion()) {
      el.classList.add("in");
      return;
    }
    window.setTimeout(() => el.classList.add("in"), i * stepMs);
  });
}

/** Fades the content container out, swaps HTML, fades back in. */
export async function swapContent(
  container: HTMLElement,
  html: string,
): Promise<void> {
  if (prefersReducedMotion()) {
    container.innerHTML = html;
    return;
  }
  container.classList.add("page-leave");
  await wait(140);
  container.innerHTML = html;
  container.classList.remove("page-leave");
  container.classList.add("page-enter");
  requestAnimationFrame(() => {
    container.classList.remove("page-enter");
  });
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** Runs every entrance animation for freshly rendered content. */
export function animateIn(root: ParentNode = document): void {
  revealStagger(root);
  runCountUps(root);
  growBars(root);
  drawDonuts(root);
}
