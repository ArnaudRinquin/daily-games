import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchLeaderboard,
  fetchMe,
  type Board,
  type Leaderboard,
  type Me,
  type Range,
  type Standing,
} from './api';
import { tapFeedback } from './telegram';

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  week: 'This week',
  all: 'All time',
};

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (rank: number) => MEDALS[rank - 1] ?? String(rank);
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

function prettyDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T12:00:00Z`));
}

function GameCard({ board, viewerId }: { board: Board; viewerId: number }) {
  return (
    <section className="card">
      <header className="card-head">
        <span className="card-title">
          {board.emoji} {board.label}
        </span>
        <span className="card-meta">
          {board.rows.length}/{board.field}
        </span>
      </header>
      {board.rows.map((row) => (
        <div
          key={row.userId}
          className={`row${row.userId === viewerId ? ' is-viewer' : ''}`}
        >
          <span className="rank">{place(row.rank)}</span>
          <span className="name">{row.name}</span>
          <span className="score">{row.display}</span>
          <span className="points">+{row.points}</span>
        </div>
      ))}
      {board.absent.length > 0 && (
        <p className="absent">Absent: {board.absent.map((p) => p.name).join(', ')}</p>
      )}
    </section>
  );
}

function StandingsCard({
  title,
  meta,
  rows,
  viewerId,
  value,
}: {
  title: string;
  meta?: string;
  rows: Standing[];
  viewerId: number;
  value: (s: Standing) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <header className="card-head">
        <span className="card-title">{title}</span>
        {meta && <span className="card-meta">{meta}</span>}
      </header>
      {rows.map((s, i) => (
        <div key={s.userId} className={`row${s.userId === viewerId ? ' is-viewer' : ''}`}>
          <span className="rank">{place(i + 1)}</span>
          <span className="name">{s.name}</span>
          <span className="score">{value(s)}</span>
          <span className="points">{games(s.gamesPlayed)}</span>
        </div>
      ))}
    </section>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [range, setRange] = useState<Range>('today');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setMe(data);
        setChatId(data.groups[0]?.chatId ?? null);
        if (data.groups.length === 0) setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Could not reach the bot.');
        if (e instanceof ApiError && e.diagnosis) setDiagnosis(e.diagnosis);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (chatId === null) return;
    setLoading(true);
    let cancelled = false;
    fetchLeaderboard(chatId, range)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the board.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, range]);

  const pickRange = useCallback((next: Range) => {
    tapFeedback();
    setRange(next);
  }, []);

  if (error) {
    return (
      <div className="app">
        <p className="state">
          <strong>{error}</strong>
          Open this from the leaderboard button inside Telegram.
          {diagnosis && <code className="diag">{diagnosis}</code>}
        </p>
      </div>
    );
  }

  if (me && me.groups.length === 0) {
    return (
      <div className="app">
        <p className="state">
          <strong>No leaderboards yet</strong>
          Add the bot to a group chat and tap the link it posts.
        </p>
      </div>
    );
  }

  const viewerId = me?.viewer.id ?? board?.viewerId ?? -1;
  const todayBoards = board?.boards.filter((b) => b.playDate === board.playDate) ?? [];

  return (
    <div className="app">
      <div className="topbar">
        {me && me.groups.length > 1 ? (
          <select
            className="group-select"
            value={chatId ?? ''}
            onChange={(e) => setChatId(Number(e.target.value))}
            aria-label="Group"
          >
            {me.groups.map((g) => (
              <option key={g.chatId} value={g.chatId}>
                {g.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="group-title">{board?.group.title ?? me?.groups[0]?.title ?? '…'}</span>
        )}
        {board && <span className="date">{prettyDate(board.playDate)}</span>}
      </div>

      <div className="tabs" role="tablist">
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <button
            key={r}
            role="tab"
            className="tab"
            aria-selected={range === r}
            onClick={() => pickRange(r)}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {loading && !board && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}

      {board && range === 'today' && (
        <>
          {todayBoards.length === 0 ? (
            <p className="state">
              <strong>Nobody has played yet 🦗</strong>
              Paste your results in the DM and you'll show up here.
            </p>
          ) : (
            <>
              {todayBoards.map((b) => (
                <GameCard key={b.game} board={b} viewerId={viewerId} />
              ))}
              <StandingsCard
                title="📊 Today"
                rows={board.standings.filter((s) => s.gamesPlayed > 0)}
                viewerId={viewerId}
                value={(s) => `${s.totalPoints} pts`}
              />
            </>
          )}
        </>
      )}

      {board && range !== 'today' && (
        <>
          <StandingsCard
            title="📈 Total"
            meta="turning up"
            rows={board.standings.filter((s) => s.gamesPlayed > 0)}
            viewerId={viewerId}
            value={(s) => `${s.totalPoints} pts`}
          />
          <StandingsCard
            title="🎯 Average"
            meta="being good"
            rows={board.average}
            viewerId={viewerId}
            value={(s) => `${(s.averagePoints ?? 0).toFixed(1)}/game`}
          />
          {board.standings.every((s) => s.gamesPlayed === 0) && (
            <p className="state">
              <strong>Nothing logged yet</strong>
              Scores show up here once someone plays.
            </p>
          )}
          <p className="footnote">
            Average needs 60% of days played since you joined, so one lucky day cannot win it.
          </p>
        </>
      )}
    </div>
  );
}
