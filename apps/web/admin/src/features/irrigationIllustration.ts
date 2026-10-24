import { text as t } from '@/pages/publicCopy';

// Deliberately no API client, auth, kit identifier, timer or MQTT dependency.
// State is local to this disposable DOM panel. The illustration has no quantities.
export function irrigationIllustrationHtml(): string {
  return `<section class="irrigation-illustration visual-card" data-irrigation-illustration data-demo-state="ready" aria-labelledby="irrigationDemoTitle">
    <p class="visual-eyebrow">${t('simulated')}</p><h2 id="irrigationDemoTitle">${t('tryIrrigation')}</h2><p>${t('demoExplanation')}</p>
    <svg viewBox="0 0 640 200" aria-hidden="true" focusable="false">
      <path class="demo-soil" d="M0 154H640V200H0Z"/><path class="demo-pipe" d="M30 100H465Q485 100 485 120V135"/>
      <path class="demo-water" pathLength="1" d="M30 100H465Q485 100 485 120V135"/>
      <g class="demo-plant"><path d="M550 155V70M550 115Q510 70 510 100Q515 124 550 124M550 100Q590 55 590 85Q585 108 550 110"/></g>
      <g class="demo-drops"><circle cx="478" cy="143" r="4"/><circle cx="491" cy="148" r="4"/><circle cx="484" cy="158" r="4"/></g>
    </svg><p role="status" data-demo-status>${t('demoReady')}</p>
    <div class="visual-actions"><button type="button" class="btn demo-start" data-demo-start><svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true" focusable="false"><path d="M9 1C7 5 1 11 1 14a8 8 0 0016 0C17 11 11 5 9 1Z" fill="currentColor"/></svg> ${t('startDemo')}</button><button type="button" class="btn ghost" data-demo-stop disabled>${t('stopDemo')}</button><button type="button" class="btn ghost" data-demo-reset>${t('resetDemo')}</button></div>
    <details><summary>${t('underground')}</summary><p>${t('undergroundText')}</p><svg viewBox="0 0 640 130" aria-hidden="true" focusable="false"><path class="demo-soil" d="M0 15H640V130H0Z"/><path d="M350 0V60M350 40L310 90M350 50L380 105M350 60L340 115" fill="none" stroke="#526359" stroke-width="6"/><path d="M250 5V85" stroke="#126B91" stroke-width="10"/><path d="M20 5H220" stroke="#526575" stroke-width="12"/></svg></details>
  </section>`;
}
export function wireIrrigationIllustration(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>('[data-irrigation-illustration]');
  if (!panel) return;
  const start = panel.querySelector<HTMLButtonElement>('[data-demo-start]')!;
  const stop = panel.querySelector<HTMLButtonElement>('[data-demo-stop]')!;
  const status = panel.querySelector<HTMLElement>('[data-demo-status]')!;
  let automaticStop: number | undefined;
  const clearAutomaticStop = () => {
    if (automaticStop !== undefined) window.clearTimeout(automaticStop);
    automaticStop = undefined;
  };
  const set = (state: 'ready' | 'running' | 'stopped', automatic = false) => {
    clearAutomaticStop();
    panel.dataset['demoState'] = state;
    status.textContent = t(
      state === 'running'
        ? 'demoRunning'
        : state === 'stopped'
          ? automatic ? 'demoFinished' : 'demoStopped'
          : 'demoReady',
    );
    start.disabled = state === 'running';
    stop.disabled = state !== 'running';
    if (state === 'running')
      automaticStop = window.setTimeout(() => set('stopped', true), 8_000);
  };
  start.onclick = () => set('running');
  stop.onclick = () => set('stopped');
  panel.querySelector<HTMLButtonElement>('[data-demo-reset]')!.onclick = () => set('ready');
}
