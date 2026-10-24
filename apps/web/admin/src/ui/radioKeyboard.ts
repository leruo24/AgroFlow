// Custom button radios use their existing click/save handlers. Native inputs
// retain browser behaviour; this handles only role=radio buttons (soil cards).
export function wireRadioKeyboard(): void {
  const members = (group: Element) => Array.from(group.querySelectorAll<HTMLButtonElement>('button[role="radio"]'))
    .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  const sync = () => document.querySelectorAll('[role="radiogroup"]').forEach(group => {
    const buttons = members(group);
    const selected = buttons.find(button => button.getAttribute('aria-checked') === 'true') ?? buttons[0];
    buttons.forEach(button => { button.tabIndex = button === selected ? 0 : -1; });
  });
  document.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    const current = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[role="radio"]') : null;
    const group = current?.closest('[role="radiogroup"]');
    if (!current || !group) return;
    const buttons = members(group), at = buttons.indexOf(current);
    if (at < 0 || !buttons.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (at + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['aria-checked','aria-disabled','disabled']});
  sync();
}
