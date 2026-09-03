/** Row shapes as they come back from D1, and the shapes assembled from them. */

export interface PlayerRow {
  user_id: number;
  username: string | null;
  first_name: string;
  reminder_hour: number;
  active: number;
  joined_at: number;
  api_token: string | null;
}

export interface GroupRow {
  chat_id: number;
  title: string;
  active: number;
  joined_at: number;
}

export interface ScoreRow {
  user_id: number;
  game: string;
  play_date: string;
  value: number;
  display: string;
  raw: string;
}

export interface MemberInfo {
  userId: number;
  name: string;
  active: boolean;
  joinedAt: number;
  /** Selected games, already filtered to those with a working parser. */
  games: string[];
}
