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
