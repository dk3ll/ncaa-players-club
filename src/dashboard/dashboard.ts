import { owners } from "./picks";

// NCAA team name -> seoname mapping for the stats API
// Maps common names used in the draft to the NCAA seo slug
const teamSeoMap: Record<string, string> = {
  Duke: "duke",
  Kansas: "kansas",
  Florida: "florida",
  "Texas Tech": "texas-tech",
  Wisconsin: "wisconsin",
  "North Carolina": "north-carolina",
  "St. Johns": "st-johns",
  McNeese: "mcneese-st",
  Arkansas: "arkansas",
  "Saint Marys": "saint-marys-ca",
  Arizona: "arizona",
  Michigan: "michigan",
  Iowa: "iowa",
  Illinois: "illinois",
  Alabama: "alabama",
  Purdue: "purdue",
  Vanderbilt: "vanderbilt",
  Nebraska: "nebraska",
  Houston: "houston",
  "Michigan State": "michigan-st",
  MSU: "michigan-st",
  Gonzaga: "gonzaga",
  UConn: "connecticut",
  Uconn: "connecticut",
  "Ohio State": "ohio-st",
  OSU: "ohio-st",
  Akron: "akron",
  "Utah State": "utah-st",
  Virginia: "virginia",
  Georgia: "georgia",
  "Iowa State": "iowa-st",
  BYU: "byu",
  Louisville: "louisville",
  "St. Marys": "saint-marys-ca",
  UCLA: "ucla",
  "CA Baptist": "california-baptist",
  Hofstra: "hofstra",
  Tennessee: "tennessee",
  Tenn: "tennessee",
  Miami: "miami-fl",
  "Miami OH": "miami-oh",
  SMU: "smu",
  Missouri: "missouri",
  "South Florida": "south-florida",
  VCU: "vcu",
  UCF: "ucf",
  Idaho: "idaho",
  Utah: "utah",
  Kentucky: "kentucky",
  Texas: "texas",
  "Texas A&M": "texas-am",
  Wis: "wisconsin",
  UNC: "north-carolina",
  "St John": "st-johns",
};

export interface PlayerStats {
  name: string;
  team: string;
  points: number;
  gamesPlayed: number;
}

export interface OwnerStats {
  real_name: string;
  team_name: string;
  total_points: number;
  players: PlayerStats[];
}

/**
 * Fetch tournament box scores for a team and accumulate player points.
 * Uses the scoreboard to find game IDs, then fetches boxscores.
 */
async function fetchPlayerPointsForTeam(
  teamSeo: string
): Promise<Record<string, { points: number; games: number }>> {
  const playerPoints: Record<string, { points: number; games: number }> = {};

  try {
    // Fetch recent tournament games via scoreboard for men's basketball d1
    // We'll search across tournament dates (March/April 2026)
    const dates = getTournamentDates();

    for (const date of dates) {
      try {
        const url = `http://localhost:3000/scoreboard/basketball-men/d1/${date}/all-conf`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const data = await res.json();
        const games = data?.games || [];

        for (const gameObj of games) {
          const game = gameObj?.game;
          if (!game) continue;

          const homeSeo = game.home?.names?.seo?.toLowerCase();
          const awaySeo = game.away?.names?.seo?.toLowerCase();

          if (homeSeo !== teamSeo && awaySeo !== teamSeo) continue;
          if (!game.gameID) continue;

          // Only fetch completed games
          if (game.gameState !== "final") continue;

          // Fetch boxscore for this game
          try {
            const bsRes = await fetch(`http://localhost:3000/game/${game.gameID}/boxscore`);
            if (!bsRes.ok) continue;
            const bs = await bsRes.json();

            const teamBoxscores = bs?.teamBoxscore || [];
            for (const teamBs of teamBoxscores) {
              const teamNameSeo = teamBs?.team?.seoname?.toLowerCase();
              if (teamNameSeo !== teamSeo) continue;

              const playerStats = teamBs?.playerStats || [];
              for (const ps of playerStats) {
                const playerName = ps?.player?.name;
                if (!playerName) continue;
                const pts = parseInt(ps?.stats?.pts ?? ps?.stats?.points ?? "0", 10) || 0;
                if (!playerPoints[playerName]) {
                  playerPoints[playerName] = { points: 0, games: 0 };
                }
                playerPoints[playerName].points += pts;
                playerPoints[playerName].games += 1;
              }
            }
          } catch (_) {
            // skip failed boxscore fetches
          }
        }
      } catch (_) {
        // skip failed date fetches
      }
    }
  } catch (_) {
    // return empty on failure
  }

  return playerPoints;
}

/** Generate YYYY/MM/DD date strings for the 2026 NCAA tournament window */
function getTournamentDates(): string[] {
  const dates: string[] = [];
  // Tournament runs mid-March through early April
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
 * Normalize a player name for fuzzy matching (lowercase, strip suffixes/positions)
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(g|f|c|jr\.?|sr\.?|ii|iii|iv)\s*$/i, "")
    .replace(/[^a-z\s']/g, "")
    .trim();
}

/**
 * Try to match a draft player name against API player names
 */
function matchPlayer(
  draftName: string,
  apiPlayers: Record<string, { points: number; games: number }>
): { points: number; games: number } {
  const normalized = normalizeName(draftName);

  // Exact normalized match
  for (const [apiName, stats] of Object.entries(apiPlayers)) {
    if (normalizeName(apiName) === normalized) return stats;
  }

  // Partial match — draft name words all appear in api name
  const draftWords = normalized.split(" ").filter((w) => w.length > 2);
  for (const [apiName, stats] of Object.entries(apiPlayers)) {
    const apiNorm = normalizeName(apiName);
    if (draftWords.every((w) => apiNorm.includes(w))) return stats;
  }

  return { points: 0, games: 0 };
}

/**
 * Build full stats for all owners by fetching live data
 */
export async function buildDashboardStats(): Promise<OwnerStats[]> {
  // Collect unique teams
  const allTeams = new Set<string>();
  for (const owner of owners) {
    for (const player of owner.players) {
      allTeams.add(player.team);
    }
  }

  // Fetch stats per team (in parallel, capped)
  const teamStatsMap: Record<string, Record<string, { points: number; games: number }>> = {};
  await Promise.all(
    [...allTeams].map(async (team) => {
      const seo = teamSeoMap[team];
      if (!seo) return;
      teamStatsMap[team] = await fetchPlayerPointsForTeam(seo);
    })
  );

  // Build owner stats
  return owners.map((owner) => {
    const playerStats: PlayerStats[] = owner.players.map((p) => {
      const teamData = teamStatsMap[p.team] ?? {};
      const matched = matchPlayer(p.name, teamData);
      return {
        name: p.name,
        team: p.team,
        points: matched.points,
        gamesPlayed: matched.games,
      };
    });

    const total_points = playerStats.reduce((sum, p) => sum + p.points, 0);
    return {
      real_name: owner.real_name,
      team_name: owner.team_name,
      total_points,
      players: playerStats.sort((a, b) => b.points - a.points),
    };
  });
}
