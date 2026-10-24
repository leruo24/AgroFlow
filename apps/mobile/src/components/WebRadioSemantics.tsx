import { useEffect } from 'react';
import { Platform } from 'react-native';

// Keyboard/roving focus for the existing choices, not a second preference or save
// implementation. Calling click uses each screen's existing onPress callback.
export function WebRadioSemantics() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const members = (group: Element) => Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'))
      .filter(radio => radio.closest('[role="radiogroup"]') === group && radio.getAttribute('aria-disabled') !== 'true');
    const sync = () => document.querySelectorAll('[role="radiogroup"]').forEach(group => {
      const radios = members(group);
      const selected = radios.find(radio => radio.getAttribute('aria-checked') === 'true') ?? radios[0];
      radios.forEach(radio => { const tab = radio === selected ? 0 : -1; if (radio.tabIndex !== tab) radio.tabIndex = tab; });
    });
    const keydown = (event: KeyboardEvent) => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      const current = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="radio"]') : null;
      const group = current?.closest('[role="radiogroup"]');
      if (!current || !group) return;
      const radios = members(group), at = radios.indexOf(current);
      if (at < 0 || !radios.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1
        : (at + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + radios.length) % radios.length;
      radios[next].focus(); radios[next].click();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked','aria-disabled'] });
    document.addEventListener('keydown', keydown);
    return () => { observer.disconnect(); document.removeEventListener('keydown', keydown); };
  }, []);
  return null;
}
