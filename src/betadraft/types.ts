// Types for the Beta Draft system

export interface DraftPlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  ppg: number;
  rpg: number;
  apg: number;
  fantasyScore: number;
}

export interface DraftPick {
  round: number;
  pickNumber: number;
  ownerId: string;
  player: DraftPlayer;
}

export interface DraftOwner {
  id: string;
  name: string;
  teamName: string;
  picks: DraftPlayer[];
}

export interface DraftConfig {
  rounds: number;
  timerSeconds: number;
  maxTeams: number;
  leagueName: string;
  leaguePassword: string;
}

export interface DraftRoom {
  roomCode: string;
  status: "lobby" | "active" | "paused" | "complete";
  config: DraftConfig;
  owners: DraftOwner[];
  draftOrder: string[]; // owner IDs in draft order
  commissionerId: string;
  currentPick: number;
  currentRound: number;
  currentPickOwner: string;
  timerExpiresAt: number | null;
  picks: DraftPick[];
  playerPool: DraftPlayer[];
  playerPoolCount: number;
  leagueId?: string;
  createdAt: number;
}

export interface Registration {
  firstName: string;
  lastName: string;
  email: string;
  donation: string;
  accessKey: string;
  createdAt: number;
}

export interface FeedbackEntry {
  page: string;
  message: string;
  rating: number;
  createdAt: number;
}

export interface AdminSession {
  token: string;
  createdAt: number;
}
