// Fetches NCAA men's basketball D1 tournament players to build the draft player pool
import type { DraftPlayer } from "./types";

/** log message to console with timestamp */
function log(str: string) {
  console.log(`[${new Date().toISOString().substring(0, 19).replace("T", " ")}] [Draft] ${str}`);
}

const BASE_URL = "http://localhost:3000";

/**
 * Seed-based multiplier representing expected tournament games.
 * Higher seeds are expected to advance further, increasing their projected total contribution.
 * Based on CPP Draft Guide methodology.
 */
const SEED_MULTIPLIER: Record<number, number> = {
  1: 6.0,
  2: 4.5,
  3: 4.0,
  4: 3.5,
  5: 3.0,
  6: 3.0,
  7: 2.5,
  8: 2.5,
  9: 2.0,
  10: 2.0,
  11: 2.0,
  12: 2.0,
  13: 1.0,
  14: 1.0,
  15: 1.0,
  16: 1.0,
};

/**
 * Fetch all tournament game IDs and team seeds from the scoreboard.
 */
async function fetchTournamentGameIdsAndSeeds(): Promise<{
  gameIds: string[];
  teamSeeds: Map<string, number>;
}> {
  const gameIds: string[] = [];
  const teamSeeds = new Map<string, number>();
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
        // Extract seed info from both home and away teams
        for (const side of ["home", "away"]) {
          const team = g?.game?.[side];
          const teamName =
            team?.names?.full || team?.names?.short || team?.names?.seo || "";
          const seed = parseInt(team?.seed, 10);
          if (teamName && seed >= 1 && seed <= 16) {
            teamSeeds.set(teamName.toLowerCase(), seed);
          }
        }
      }
    } catch (_) {
      /* skip */
    }
  }
  return { gameIds: [...new Set(gameIds)], teamSeeds };
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
      const teamName = teamBs?.team?.name || teamBs?.team?.seoname || teamBs?.teamName || `team-${teamBs?.teamId || "unknown"}`;
      const playerStats = teamBs?.playerStats || [];
      for (const ps of playerStats) {
        // Handle both nested format (ps.player.name) and flat format (ps.firstName + ps.lastName)
        const playerName = ps?.player?.name || [ps?.firstName, ps?.lastName].filter(Boolean).join(" ");
        if (!playerName) continue;
        const key = `${playerName}|${teamName}`;
        const pts = parseInt(ps?.stats?.pts ?? ps?.stats?.points ?? ps?.points ?? "0", 10) || 0;
        const reb = parseInt(ps?.stats?.reb ?? ps?.stats?.rebounds ?? ps?.totalRebounds ?? "0", 10) || 0;
        const ast = parseInt(ps?.stats?.ast ?? ps?.stats?.assists ?? ps?.assists ?? "0", 10) || 0;
        const position = ps?.player?.position || ps?.stats?.pos || ps?.position || "";
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
 * Ranking uses CPP Draft Guide methodology:
 * - P/R/A PG = PPG + RPG + APG (unweighted sum)
 * - Fantasy Score = P/R/A PG × seed multiplier (expected tournament games)
 */
export async function buildPlayerPool(): Promise<DraftPlayer[]> {
  const { gameIds, teamSeeds } = await fetchTournamentGameIdsAndSeeds();
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
    // P/R/A PG: unweighted sum of per-game averages
    const praPg = Math.round((ppg + rpg + apg) * 10) / 10;
    // Look up team seed (default to 16 if unknown)
    const seed = teamSeeds.get(stats.team.toLowerCase()) || 16;
    const multiplier = SEED_MULTIPLIER[seed] ?? 1.0;
    // Fantasy score: P/R/A × seed multiplier (projected tournament contribution)
    const fantasyScore = Math.round(praPg * multiplier * 10) / 10;
    players.push({
      id: id++,
      name: stats.name,
      team: stats.team,
      position: stats.position,
      ppg,
      rpg,
      apg,
      seed,
      praPg,
      fantasyScore,
    });
  }

  players.sort((a, b) => b.fantasyScore - a.fantasyScore);
  log(`Processed ${players.length} unique players`);
  return players;
}
