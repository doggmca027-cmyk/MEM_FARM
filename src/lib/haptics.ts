import WebApp from '@twa-dev/sdk';

type Impact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type Notify = 'success' | 'warning' | 'error';

/**
 * Thin haptics wrapper. Every call is guarded so the app also runs
 * fine in a normal browser (outside Telegram) without throwing.
 */
export const haptic = {
  impact(style: Impact = 'medium') {
    try {
      WebApp.HapticFeedback.impactOccurred(style);
    } catch {
      /* not in Telegram */
    }
  },
  notify(type: Notify = 'success') {
    try {
      WebApp.HapticFeedback.notificationOccurred(type);
    } catch {
      /* not in Telegram */
    }
  },
  select() {
    try {
      WebApp.HapticFeedback.selectionChanged();
    } catch {
      /* not in Telegram */
    }
  },
};
