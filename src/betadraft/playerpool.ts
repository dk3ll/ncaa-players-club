// Fetches NCAA men's basketball D1 tournament players to build the draft player pool
import type { DraftPlayer } from "./types";

function log(str: string) {
  console.log(`[${new Date().toISOString().substring(0, 19).replace("T", " ")}] [Draft] ${str}`);
}

const BASE_URL = "http://localhost:3000";

const SEED_MULTIPLIER: Record<number, number> = {
  1: 6.0, 2: 4.5, 3: 4.0, 4: 3.5, 5: 3.0, 6: 3.0,
  7: 2.5, 8: 2.5, 9: 2.0, 10: 2.0, 11: 2.0, 12: 2.0,
  13: 1.0, 14: 1.0, 15: 1.0, 16: 1.0,
};

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
 * Fetch all tournament game IDs, team seeds, and teamId-to-name mapping from scoreboard.
 */
async function fetchTournamentGames(): Promise<{
  gameIds: string[];
  teamSeeds: Map<string, number>;
  teamIdToName: Map<string, string>;
}> {
  const gameIds: string[] = [];
  const teamSeeds = new Map<string, number>();
  const teamIdToName = new Map<string, string>();

  for (const date of getTournamentDates()) {
    try {
      const res = await fetch(`${BASE_URL}/scoreboard/basketball-men/d1/${date}/all-conf`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const g of data?.games || []) {
        const game = g?.game;
        if (!game) continue;
        const id = game.gameID;
        if (id && game.gameState === "final") gameIds.push(String(id));
        for (const side of ["home", "away"] as const) {
          const team = game[side];
          if (!team) continue;
          const name = team.names?.short || team.names?.seo || "";
          const seed = parseInt(team.seed, 10);
          if (name && seed >= 1 && seed <= 16) {
            teamSeeds.set(name.toLowerCase(), seed);
          }
        }
      }
    } catch (_) { /* skip */ }
  }

  // Fetch game details to build teamId → name mapping
  const uniqueIds = [...new Set(gameIds)];
  for (let i = 0; i < uniqueIds.length; i += 10) {
    const batch = uniqueIds.slice(i, i + 10);
    await Promise.all(batch.map(async (gid) => {
      try {
        const res = await fetch(`${BASE_URL}/game/${gid}`);
        if (!res.ok) return;
        const data = await res.json();
        const teams = data?.contests?.[0]?.teams || data?.gamecenter?.contest?.teams || [];
        for (const t of teams) {
          const tid = String(t.teamId || t.id || "");
          const name = t.nameShort || t.seoname || "";
          if (tid && name) teamIdToName.set(tid, name);
        }
      } catch (_) { /* skip */ }
    }));
  }

  return { gameIds: uniqueIds, teamSeeds, teamIdToName };
}

/**
 * Fetch boxscore for a game and extract player stats.
 * Uses teamIdToName map to resolve proper team names from teamId.
 */
async function fetchBoxscorePlayers(
  gameId: string,
  teamIdToName: Map<string, string>
): Promise<
  Map<string, { name: string; team: string; position: string; pts: number; reb: number; ast: number }>
> {
  const players = new Map<string, { name: string; team: string; position: string; pts: number; reb: number; ast: number }>();
  try {
    const res = await fetch(`${BASE_URL}/game/${gameId}/boxscore`);
    if (!res.ok) return players;
    const bs = await res.json();
    for (const teamBs of bs?.teamBoxscore || []) {
      // Resolve team name: try team object first, then teamId lookup, then fallback
      const tid = String(teamBs?.teamId || "");
      const teamName = teamBs?.team?.nameShort || teamBs?.team?.name || teamBs?.team?.seoname
        || teamIdToName.get(tid) || teamBs?.teamName || `team-${tid}`;

      for (const ps of teamBs?.playerStats || []) {
        const playerName = ps?.player?.name
          || [ps?.firstName, ps?.lastName].filter(Boolean).join(" ");
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
  } catch (_) { /* skip */ }
  return players;
}

/**
 * Build the full player pool from tournament boxscores.
 * Ranking: Fantasy Score = (PPG + RPG + APG) × seed multiplier
 */
export async function buildPlayerPool(): Promise<DraftPlayer[]> {
  const { gameIds, teamSeeds, teamIdToName } = await fetchTournamentGames();
  log(`Found ${gameIds.length} games, fetching boxscores...`);

  const accumulated = new Map<string, {
    name: string; team: string; position: string;
    pts: number; reb: number; ast: number; games: number;
  }>();

  for (let i = 0; i < gameIds.length; i += 10) {
    const batch = gameIds.slice(i, i + 10);
    const results = await Promise.all(batch.map(gid => fetchBoxscorePlayers(gid, teamIdToName)));
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

  let id = 1;
  const players: DraftPlayer[] = [];
  for (const [, stats] of accumulated) {
    const g = stats.games || 1;
    const ppg = Math.round((stats.pts / g) * 10) / 10;
    const rpg = Math.round((stats.reb / g) * 10) / 10;
    const apg = Math.round((stats.ast / g) * 10) / 10;
    const praPg = Math.round((ppg + rpg + apg) * 10) / 10;
    const seed = teamSeeds.get(stats.team.toLowerCase()) || 16;
    const multiplier = SEED_MULTIPLIER[seed] ?? 1.0;
    const fantasyScore = Math.round(praPg * multiplier * 10) / 10;
    players.push({
      id: id++, name: stats.name, team: stats.team,
      position: stats.position, ppg, rpg, apg, seed, praPg, fantasyScore,
    });
  }

  players.sort((a, b) => b.fantasyScore - a.fantasyScore);
  log(`Processed ${players.length} unique players`);
  return players;
}
