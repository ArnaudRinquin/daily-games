import { initData } from './telegram';

export interface Group {
  chatId: number;
  title: string;
}

export interface Me {
  viewer: { id: number; firstName: string; username: string | null };
  groups: Group[];
  games: { id: string; label: string; emoji: string; url: string }[];
}

export interface BoardRow {
  userId: number;
  name: string;
  rank: number;
  points: number;
  display: string;
}

export interface Board {
  game: string;
  label: string;
  emoji: string;
  playDate: string;
  field: number;
  rows: BoardRow[];
  absent: { userId: number; name: string }[];
}

export interface Standing {
  userId: number;
  name: string;
  totalPoints: number;
  gamesPlayed: number;
  daysPlayed: number;
  averagePoints: number | null;
  rankedOnAverage: boolean;
}

export interface Leaderboard {
  range: Range;
  playDate: string;
  from: string;
  viewerId: number;
  group: Group;
  boards: Board[];
  standings: Standing[];
  average: Standing[];
}

export type Range = 'today' | 'week' | 'all';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `tma ${initData()}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export const fetchMe = () => get<Me>('/api/me');

export const fetchLeaderboard = (chatId: number, range: Range) =>
  get<Leaderboard>(`/api/leaderboard?group=${chatId}&range=${range}`);
