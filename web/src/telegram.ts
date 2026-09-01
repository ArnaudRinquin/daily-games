export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  themeParams: Record<string, string>;
  HapticFeedback?: { selectionChanged(): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const webApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

/** The signed string the Worker verifies. Empty outside Telegram. */
export const initData = (): string => webApp()?.initData ?? '';

export function tapFeedback(): void {
  webApp()?.HapticFeedback?.selectionChanged();
}

/**
 * Why auth failed, in the viewer's own words. The server deliberately says only
 * "unauthorized", so without this a launch problem and a signature problem look
 * identical from the outside.
 */
export function launchDiagnosis(): string {
  const app = webApp();
  if (!app) return 'Telegram SDK did not load (window.Telegram is missing).';
  const data = app.initData ?? '';
  if (!data) {
    const hash = typeof location !== 'undefined' ? location.hash : '';
    return hash.includes('tgWebAppData')
      ? 'Launch params are in the URL but initData is empty.'
      : 'Telegram passed no launch params — opened outside a Mini App launch.';
  }
  const keys = [...new URLSearchParams(data).keys()].sort().join(', ');
  return `initData present (${data.length} chars): ${keys}`;
}
