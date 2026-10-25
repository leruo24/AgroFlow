import { brandHtml } from "@/ui/brand";
import { appearanceHtml, wireAppearance } from "@/ui/appearance";
import { text as t, publicLanguage, type CopyKey } from "./publicCopy";
import { WEB_APP_URL, appLinksHtml } from "@/lib/downloads";
import { visualCatalogueHtml } from "./visualCatalogue";
import termsDraft from "@/content/terms-draft.md?raw";
import privacyDraft from "@/content/privacy-draft.md?raw";
import { legalDraftHtml } from "@/ui/legalDraft";
import { wirePublicFacts } from "@/ui/publicFacts";
import { photoHtml } from '@/ui/agroflowImages';
import { Icon } from "@/lib/icons";

const routes: readonly [string, CopyKey][] = [
  ["/", "home"],
  ["/solutions", "solutions"],
  ["/how-it-works", "how"],
  ["/technology", "technology"],
  ["/about", "about"],
  ["/get-the-app", "app"],
  ["/contact", "contact"],
  ["/service-pricing", "pricing"],
  ["/terms", "terms"],
  ["/privacy", "privacy"],
];
const legacy: Record<string, string> = {
  experience: "/",
  solutions: "/solutions",
  "how-it-works": "/how-it-works",
  technology: "/technology",
  about: "/about",
  "get-app": "/get-the-app",
  "the-app": "/get-the-app",
  enquire: "/contact",
};
const card = (title: CopyKey, body: CopyKey, href?: string) =>
  `<article class="visual-card"><h2>${t(title)}</h2><p>${t(body)}</p>${href ? `<a href="${href}">${t(href === "/how-it-works" ? "how" : "pricing")} <span aria-hidden="true">→</span></a>` : ""}</article>`;
const cta = () =>
  `<a class="btn" href="/contact#enquire">${t("call")} <span aria-hidden="true">↗</span></a>`;
export const fieldArt = `<svg class="field-lines" viewBox="0 0 600 220" aria-hidden="true" focusable="false"><circle cx="466" cy="58" r="31" fill="currentColor" opacity=".15"/><g fill="none" stroke="currentColor" stroke-width="2" opacity=".3"><path d="M0 175Q140 80 300 156T600 132M0 191Q140 96 300 172T600 148M0 207Q140 112 300 188T600 164M0 223Q140 128 300 204T600 180"/><path d="M130 156v-50q-38-32-45-7 2 23 45 22 33-55 53-30-4 23-53 41"/></g></svg>`;

// Reuse the existing enquiry, gallery and hardware components and their wiring.
// No contact fields or API bodies are replaced here. The public site shows no simulated data:
// the old /experience demo page now opens Home.
export function renderPublicSite(original: string): string {
  if (/^\/experience\/?$/.test(window.location.pathname))
    history.replaceState(null, "", "/" + window.location.search);
  const fragment = window.location.hash.slice(1);
  if (window.location.pathname === "/" && legacy[fragment])
    history.replaceState(
      null,
      "",
      legacy[fragment] +
        window.location.search +
        (fragment === "enquire" ? "#enquire" : ""),
    );
  if (window.location.pathname.replace(/\/$/, "") === "/experience")
    history.replaceState(
      null,
      "",
      "/get-the-app" + window.location.search + window.location.hash,
    );
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const route = routes.find(([href]) => href === path);
  const label = route?.[1] ?? "missing";
  document.title = `${t(label)} | AgroFlow`;
  document.documentElement.lang = publicLanguage();
  const source = new DOMParser().parseFromString(original, "text/html");
  const section = (selector: string) =>
    source.querySelector(selector)?.outerHTML ?? "";
  const hero = (title: CopyKey, body: CopyKey) =>
    `<section class="visual-hero"><div><p class="visual-eyebrow">${t("eyebrow")}</p><h1 id="publicTitle">${t(title)}</h1><p class="visual-lede">${t(body)}</p><div class="visual-actions">${cta()}<a href="/how-it-works">${t("how")} →</a><a href="${WEB_APP_URL}">${t('openFarmerApp')}</a></div></div>${photoHtml('hero',true)}</section>`;
  const heading = (title: CopyKey, body: CopyKey) => `<section class="visual-page-heading"><p class="visual-eyebrow">${t('eyebrow')}</p><h1 id="publicTitle">${t(title)}</h1><p class="visual-lede">${t(body)}</p></section>`;
  const outcomes = `<section class="visual-grid" aria-label="${t("field")}">${card("soil", "soilBody")}${card("advice", "adviceBody")}${card("watering", "wateringBody")}</section>`;
  const photographicFeatures = `<section class="premium-features"><div class="premium-split">${photoHtml('sprinkler')}${card('watering','wateringBody')}</div><div class="premium-split premium-reverse">${photoHtml('irrigation')}${card('advice','adviceBody')}</div><div class="premium-feature-pair"><div>${photoHtml('sensor')}${card('soil','soilBody')}</div><div>${photoHtml('seedling')}${card('purpose','purposeBody')}</div></div><div class="premium-split">${photoHtml('reservoir')}${card('receive','receiveBody')}</div></section>`;
  let body = "";
  switch (path) {
    case "/":
      body =
        hero("hero", "intro") +
        outcomes +
        photographicFeatures +
        `<section class="visual-band"><h2>${t("receive")}</h2><p>${t("receiveBody")}</p><a href="/solutions">${t("solutions")} →</a></section><section class="visual-summary"><h2>${t("start")}</h2><p>${t("journey")}</p><a href="/how-it-works">${t("how")} →</a><a href="/service-pricing">${t("pricing")} →</a></section>`;
      break;
    case "/solutions":
      body =
        heading("field", "intro") +
        outcomes +
        photographicFeatures +
        `<section class="visual-grid">${card("receive", "receiveBody", "/service-pricing")}${card("requirements", "requirementsBody")}</section>`;
      break;
    case "/how-it-works":
      body =
        heading("start", "journey") +
        photoHtml('irrigation') +
        outcomes +
        `<section class="visual-band"><h2>${t("requirements")}</h2><p>${t("requirementsBody")}</p></section>`;
      break;
    case "/about":
      body =
        heading("aboutTitle", "purposeBody") +
        photoHtml('seedling') +
        `<section class="visual-grid about-grid">${card("purpose", "purposeBody")}${card("who", "whoBody")}${card("roles", "rolesBody")}${card("project", "projectBody")}${card("team", "teamBody")}${card("sponsor", "sponsorBody")}${card("receive", "receiveBody", "/service-pricing")}${card("start", "journey", "/how-it-works")}</section>` +
        `<section class="visual-band" data-about-contact><h2>${t("reach")}</h2><p>${t("reachBody")}</p>${cta()}</section>`;
      break;
    case "/technology":
      body =
        heading("technology", "projectBody") +
        section("[data-hardware-showcase]") +
        section("#technology");
      break;
    case "/get-the-app":
      body =
        heading("app", "intro") +
        `<section class="visual-band">${appLinksHtml()}<p><a href="${WEB_APP_URL}">${t("signIn")}</a></p></section>`;
      break;
    case "/contact":
      body = heading("contact", "enquiryNote") + section("#enquire");
      break;
    case "/service-pricing":
      body =
        heading("pricingTitle", "receiveBody") +
        `<section class="visual-grid"><article class="visual-card"><h2>${t("install")}</h2><p class="visual-price" data-price="installation"><span data-price-amount>R4,000</span></p><p>${t("quote")}</p></article><article class="visual-card"><h2>${t("monthly")}</h2><p class="visual-price" data-price="monthly"><span data-price-amount>R610</span> / ${publicLanguage() === "af" ? "maand" : publicLanguage() === "tn" ? "kgwedi" : "month"}</p><p>${t("quote")}</p></article></section><section class="visual-band"><p>${t("costs")}</p>${cta()}</section>`;
      break;
    case "/terms":
    case "/privacy":
      body =
        heading(label, "draftBody") +
        `<section class="visual-band" role="status"><h2 data-legal-draft>${t("draft")}</h2><p>${t("legalLanguage")}</p><p data-legal-version>0.1-draft · <time datetime="2026-10-23">2026-10-23</time></p></section><article class="legal-document" lang="en" data-legal-doc="${path === "/terms" ? "terms" : "privacy"}">${legalDraftHtml(path === "/terms" ? termsDraft : privacyDraft)}</article>`;
      break;
    default:
      body =
        import.meta.env.DEV && path === "/component-catalogue"
          ? visualCatalogueHtml()
          : heading("missing", "missingBody");
  }
  body = body.replace(/href="#enquire"/g, 'href="/contact#enquire"');
  const link = ([href, key]: readonly [string, CopyKey]) =>
    `<a href="${href}" ${href === path ? 'aria-current="page"' : ""}>${t(key)}</a>`;
  const serviceRoutes = routes.filter(([href]) =>
    ["/solutions", "/how-it-works", "/technology", "/service-pricing"].includes(href),
  );
  const primaryRoutes = routes.filter(([href]) =>
    ["/", "/about", "/contact"].includes(href),
  );
  const onServiceRoute = serviceRoutes.some(([href]) => href === path);
  const nav = `${link(primaryRoutes[0]!)}<details class="public-service-menu${onServiceRoute ? " is-current" : ""}" data-service-menu><summary>${t("ourService")}</summary><div>${serviceRoutes.map(link).join("")}</div></details>${primaryRoutes.slice(1).map(link).join("")}`;
  const languageCode = publicLanguage().toUpperCase();
  return `<div class="landing visual-site"><a class="visual-skip" href="#publicContent">${t("skip")}</a><header class="visual-header"><div class="visual-header-inner"><a class="public-brand" href="/" aria-label="AgroFlow home">${brandHtml()}</a><button class="public-menu-toggle" type="button" data-public-menu aria-controls="publicNav" aria-expanded="false">${Icon.menu}<span class="sr-only">${t("menu")}</span></button><div class="public-menu-panel" id="publicNav"><button type="button" class="public-menu-close" data-public-menu-close>${Icon.x}<span>${t("close")}</span></button><nav class="public-primary-nav" aria-label="${t("nav")}">${nav}</nav><div class="visual-preferences">${appearanceHtml([t("theme"), t("system"), t("light"), t("dark")])}<label class="public-language" title="${t("language")}">${Icon.globe}<span class="public-language-code" aria-hidden="true">${languageCode}</span>${Icon.chevronDown}<select data-public-language aria-label="${t("language")}"><option value="en">English</option><option value="af">Afrikaans</option><option value="tn">Setswana</option></select></label><a class="public-app-cta" href="/get-the-app" ${path === "/get-the-app" ? 'aria-current="page"' : ""}>${Icon.smartphone}<span>${t("app")}</span></a></div></div></div></header><main class="visual-content" id="publicContent" tabindex="-1">${body}<aside class="visual-final"><h2>${t("eyebrow")}</h2>${cta()}${WEB_APP_URL ? `<a href="${WEB_APP_URL}">${t("signIn")}</a>` : ""}</aside></main><footer class="visual-footer">${brandHtml()}<nav aria-label="${t("footerNav")}">${routes.map(link).join("")}</nav></footer></div>`;
}

export function wirePublicSite(root: HTMLElement): void {
  root.querySelector('.visual-footer nav')?.setAttribute('aria-label', t('footerNav'));
  root
    .querySelector("[data-catalogue-back]")
    ?.addEventListener("click", () => history.back());
  wireAppearance(root);
  wirePublicFacts(root);
  const button = root.querySelector<HTMLButtonElement>("[data-public-menu]");
  const nav = root.querySelector<HTMLElement>("#publicNav");
  const close = () => {
    button?.setAttribute("aria-expanded", "false");
    nav?.classList.remove("is-open");
    document.body.classList.remove("public-menu-open");
  };
  button?.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    nav?.classList.toggle("is-open", open);
    document.body.classList.toggle("public-menu-open", open);
    if (open)
      window.requestAnimationFrame(() =>
        nav
          ?.querySelector<HTMLButtonElement>("[data-public-menu-close]")
          ?.focus(),
      );
  });
  root
    .querySelector<HTMLButtonElement>("[data-public-menu-close]")
    ?.addEventListener("click", () => {
      close();
      button?.focus();
    });
  root.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      button?.getAttribute("aria-expanded") === "true"
    ) {
      close();
      button.focus();
      return;
    }
    if (event.key !== "Tab" || button?.getAttribute("aria-expanded") !== "true" || !nav) return;
    const focusable = [...nav.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  root.addEventListener("focusout", (event) => {
    if (
      event.relatedTarget instanceof Node &&
      !nav?.contains(event.relatedTarget) &&
      event.relatedTarget !== button
    )
      close();
  });
  const language = root.querySelector<HTMLSelectElement>(
    "[data-public-language]",
  );
  if (language) {
    language.value = publicLanguage();
    language.addEventListener("change", () => {
      try {
        localStorage.setItem("agroflow_public_language", language.value);
      } catch {
        /* Storage denied. */
      }
      window.location.reload();
    });
  }
}
