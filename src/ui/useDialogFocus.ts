import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard controls inside the topmost open dialog and return focus on close. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const candidates = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]'));
    const focus = window.requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) (candidates()[0] ?? dialog).focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
      if (dialogs.at(-1) !== dialog) return;
      const items = candidates();
      const first = items[0] ?? dialog;
      const last = items.at(-1) ?? dialog;
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last) || items.length === 0) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(focus);
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
