import { InlineKeyboard } from 'grammy';
import { visibleGames } from '../games/registry';
import { MAX_REMINDER_HOUR, MIN_REMINDER_HOUR } from '../lib/time';

export const CB = {
  toggleGame: (id: string) => `g:${id}`,
  setHour: (hour: number) => `h:${hour}`,
  done: 'done',
} as const;

export function gamesKeyboard(selected: readonly string[]): InlineKeyboard {
  const set = new Set(selected);
  const kb = new InlineKeyboard();
  for (const game of visibleGames()) {
    const mark = set.has(game.id) ? '✅' : '⬜️';
    kb.text(`${mark} ${game.emoji} ${game.label}`, CB.toggleGame(game.id)).row();
  }
  kb.text('Done', CB.done);
  return kb;
}

export function hoursKeyboard(current: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  let inRow = 0;
  for (let h = MIN_REMINDER_HOUR; h <= MAX_REMINDER_HOUR; h++) {
    const label = `${h === current ? '• ' : ''}${String(h).padStart(2, '0')}:00`;
    kb.text(label, CB.setHour(h));
    if (++inRow % 4 === 0) kb.row();
  }
  return kb;
}
