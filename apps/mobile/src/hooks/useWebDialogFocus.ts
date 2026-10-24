import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

export function useWebDialogFocus(visible: boolean, panelRef: RefObject<View | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let frame = requestAnimationFrame(() => {
      const panel = panelRef.current as unknown as HTMLElement | null;
      if (panel) { panel.tabIndex = -1; panel.focus(); }
    });
    const keydown = (event: KeyboardEvent) => {
      const panel = panelRef.current as unknown as HTMLElement | null;
      if (!panel) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex="0"]'))
        .filter(element => element.getClientRects().length && element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true');
      event.preventDefault(); event.stopImmediatePropagation();
      if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
        : (at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next].focus();
    };
    document.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown, true); if (opener?.isConnected) opener.focus(); };
  }, [visible, panelRef]);
}
