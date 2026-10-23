import { publicPageHtml, wireWelcome } from './welcome';

// The public header/footer survive route changes; staff and recovery still use
// their separate authenticated document. No session state is read or manufactured.
export function mountPublicNavigation(root: HTMLElement): void {
  function show() {
    const template = document.createElement('template');
    template.innerHTML = publicPageHtml();
    const next = template.content.querySelector<HTMLElement>('#publicContent');
    const current = root.querySelector('#publicContent');
    if (!next || !current) return;
    current.replaceWith(next);
    root.querySelectorAll<HTMLAnchorElement>('.visual-header nav a').forEach(link => {
      if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const menu = root.querySelector<HTMLButtonElement>('[data-public-menu]');
    if (menu?.getAttribute('aria-expanded') === 'true') menu.click();
    wireWelcome(next);
    next.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (location.hash === '#enquire') document.getElementById('enquiryOpen')?.click();
    performance.mark('agroflow-public-navigation');
  }
  root.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || /\.(\w+)$/.test(url.pathname) ||
      /^\/(staff|admin|api|assets|media|brand)(\/|$)/.test(url.pathname) || url.searchParams.has('reset')) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    event.preventDefault();
    history.pushState(null, '', url.pathname + url.search + url.hash);
    show();
  });
  window.addEventListener('popstate', show);
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/admin' || location.hash === '#/login') location.replace('/staff/');
    if (location.hash === '#enquire') document.getElementById('enquiryOpen')?.click();
  });
}
