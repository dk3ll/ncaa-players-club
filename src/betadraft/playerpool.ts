// Fetches NCAA men's basketball D1 tournament players to build the draft player pool
import type { DraftPlayer } from "./types";

/** log message to console with timestamp */
function log(str: string) {
  console.log(`[${new Date().toISOString().substring(0, 19).replace("T", " ")}] [Draft] ${str}`);
}

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

/**
 * Fetch all tournament game IDs from the scoreboard for the current tournament window.
 */
async function fetchTournamentGameIds(): Promise<string[]> {
  const gameIds: string[] = [];
  const dates = getTournamentDates();

  for (const date of dates) {
    try {
      const url = `${BASE_URL}/scoreboard/basketball-men/d1/${date}/all-conf`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const games = data?.games || [];
      for (const g of games) {
        const id = g?.game?.gameID;
        if (id && g?.game?.gameState === "final") {
          gameIds.push(String(id));
        }
      }
    } catch (_) {
      /* skip */
    }
  }
  return [...new Set(gameIds)];
}

/** Generate date strings for the 2026 NCAA tournament window */
function getTournamentDates(): string[] {
  const dates: string[] = [];
  const start = new Date("2026-03-17");
  const end = new Date("2026-04-07");
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}/${m}/${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Fetch boxscore for a game and extract player stats.
 */
async function fetchBoxscorePlayers(
  gameId: string
): Promise<
  Map<
    string,
    { name: string; team: string; position: string; pts: number; reb: number; ast: number }
  >
> {
  const players = new Map<
    string,
    { name: string; team: string; position: string; pts: number; reb: number; ast: number }
  >();
  try {
    const res = await fetch(`${BASE_URL}/game/${gameId}/boxscore`);
    if (!res.ok) return players;
    const bs = await res.json();
    const teamBoxscores = bs?.teamBoxscore || [];
    for (const teamBs of teamBoxscores) {
      const teamName = teamBs?.team?.name || teamBs?.team?.seoname || "Unknown";
      const playerStats = teamBs?.playerStats || [];
      for (const ps of playerStats) {
        const playerName = ps?.player?.name;
        if (!playerName) continue;
        const key = `${playerName}|${teamName}`;
        const pts = parseInt(ps?.stats?.pts ?? ps?.stats?.points ?? "0", 10) || 0;
        const reb = parseInt(ps?.stats?.reb ?? ps?.stats?.rebounds ?? "0", 10) || 0;
        const ast = parseInt(ps?.stats?.ast ?? ps?.stats?.assists ?? "0", 10) || 0;
        const position = ps?.player?.position || ps?.stats?.pos || "";
        const existing = players.get(key);
        if (existing) {
          existing.pts += pts;
          existing.reb += reb;
          existing.ast += ast;
        } else {
          players.set(key, { name: playerName, team: teamName, position, pts, reb, ast });
        }
      }
    }
  } catch (_) {
    /* skip */
  }
  return players;
}

/**
 * Build the full player pool from tournament boxscores.
 * Returns sorted by fantasy score (PPG-weighted composite).
 */
export async function buildPlayerPool(): Promise<DraftPlayer[]> {
  const gameIds = await fetchTournamentGameIds();
  log(`Found ${gameIds.length} games, fetching boxscores...`);

  // Track per-player accumulated stats and game count
  const accumulated = new Map<
    string,
    {
      name: string;
      team: string;
      position: string;
      pts: number;
      reb: number;
      ast: number;
      games: number;
    }
  >();

  // Fetch boxscores in batches of 10
  for (let i = 0; i < gameIds.length; i += 10) {
    const batch = gameIds.slice(i, i + 10);
    const results = await Promise.all(batch.map(fetchBoxscorePlayers));
    for (const playerMap of results) {
      for (const [key, stats] of playerMap) {
        const existing = accumulated.get(key);
        if (existing) {
          existing.pts += stats.pts;
          existing.reb += stats.reb;
          existing.ast += stats.ast;
          existing.games += 1;
        } else {
          accumulated.set(key, { ...stats, games: 1 });
        }
      }
    }
  }

  // Convert to DraftPlayer array with per-game averages
  let id = 1;
  const players: DraftPlayer[] = [];
  for (const [, stats] of accumulated) {
    const g = stats.games || 1;
    const ppg = Math.round((stats.pts / g) * 10) / 10;
    const rpg = Math.round((stats.reb / g) * 10) / 10;
    const apg = Math.round((stats.ast / g) * 10) / 10;
    // Fantasy score: weighted composite
    const fantasyScore = Math.round((ppg * 1.0 + rpg * 1.2 + apg * 1.5) * 10) / 10;
    players.push({
      id: id++,
      name: stats.name,
      team: stats.team,
      position: stats.position,
      ppg,
      rpg,
      apg,
      fantasyScore,
    });
  }

  players.sort((a, b) => b.fantasyScore - a.fantasyScore);
  log(`Processed ${players.length} unique players`);
  return players;
}
