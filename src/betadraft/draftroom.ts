// Draft room state management
import { randomBytes } from "crypto";
import { buildPlayerPool } from "./playerpool";
import { loadJSON, saveJSON } from "./storage";
import type { DraftRoom, Registration } from "./types";

// In-memory draft rooms
const rooms = new Map<string, DraftRoom>();

// SSE connections per room
const sseClients = new Map<string, Set<{ send: (event: string, data: unknown) => void }>>();

// Registrations
const registrations: Registration[] = loadJSON<Registration[]>("registrations", []);

// Auto-pick timers
const autoPickTimers = new Map<string, ReturnType<typeof setTimeout>>();

function generateCode(len: number): string {
  return randomBytes(len).toString("hex").toUpperCase().slice(0, len);
}

function generateAccessKey(): string {
  const parts = [generateCode(4), generateCode(4), generateCode(4), generateCode(4)];
  return parts.join("-");
}

function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

function broadcastToRoom(roomCode: string, event: string, data: unknown) {
  const clients = sseClients.get(roomCode);
  if (!clients) return;
  for (const client of clients) {
    try {
      client.send(event, data);
    } catch (_) {
      clients.delete(client);
    }
  }
}

function getPublicState(room: DraftRoom): object {
  return {
    roomCode: room.roomCode,
    status: room.status,
    config: { ...room.config, leaguePassword: undefined },
    owners: room.owners.map((o) => ({
      id: o.id,
      name: o.name,
      teamName: o.teamName,
      picks: o.picks,
    })),
    draftOrder: room.draftOrder,
    commissionerId: room.commissionerId,
    currentPick: room.currentPick,
    currentRound: room.currentRound,
    currentPickOwner: room.currentPickOwner,
    timerExpiresAt: room.timerExpiresAt,
    picks: room.picks,
    playerPool: room.playerPool,
    playerPoolCount: room.playerPool.length,
    leagueId: room.leagueId,
  };
}

function saveRoom(room: DraftRoom) {
  saveJSON(`room-${room.roomCode}`, room);
}

function advancePick(room: DraftRoom) {
  // Clear existing timer
  const existingTimer = autoPickTimers.get(room.roomCode);
  if (existingTimer) clearTimeout(existingTimer);

  room.currentPick++;
  const totalPicks = room.draftOrder.length * room.config.rounds;

  if (room.currentPick >= totalPicks) {
    room.status = "complete";
    room.timerExpiresAt = null;
    room.currentPickOwner = "";
    saveRoom(room);
    broadcastToRoom(room.roomCode, "status", getPublicState(room));
    return;
  }

  // Snake draft: odd rounds go forward, even rounds go backward
  room.currentRound = Math.floor(room.currentPick / room.draftOrder.length) + 1;
  const pickInRound = room.currentPick % room.draftOrder.length;
  const isReversed = room.currentRound % 2 === 0;
  const orderIndex = isReversed ? room.draftOrder.length - 1 - pickInRound : pickInRound;
  room.currentPickOwner = room.draftOrder[orderIndex];

  // Set timer
  room.timerExpiresAt = Date.now() + room.config.timerSeconds * 1000;
  saveRoom(room);

  // Broadcast updated state so all clients see the new currentPickOwner
  broadcastToRoom(room.roomCode, "state", getPublicState(room));

  // Schedule auto-pick
  const timer = setTimeout(() => autoPick(room), room.config.timerSeconds * 1000);
  autoPickTimers.set(room.roomCode, timer);
}

function autoPick(room: DraftRoom) {
  if (room.status !== "active") return;
  const owner = room.owners.find((o) => o.id === room.currentPickOwner);
  if (!owner) return;

  // Pick highest ranked available player
  const player = room.playerPool[0];
  if (!player) return;

  // Remove from pool
  room.playerPool = room.playerPool.filter((p) => p.id !== player.id);
  owner.picks.push(player);
  room.picks.push({
    round: room.currentRound,
    pickNumber: room.currentPick,
    ownerId: owner.id,
    player,
  });

  const state = getPublicState(room);
  broadcastToRoom(room.roomCode, "autopick", { state, ownerName: owner.name });
  advancePick(room);
}

// --- Public API functions ---

export function registerUser(
  firstName: string,
  lastName: string,
  email: string,
  donation: string
): { accessKey: string } | { error: string } {
  if (!firstName || !lastName || !email)
    return { error: "All fields except donation are required" };
  // Check for duplicate email
  if (registrations.find((r) => r.email.toLowerCase() === email.toLowerCase())) {
    return { error: "Email already registered" };
  }
  const accessKey = generateAccessKey();
  registrations.push({ firstName, lastName, email, donation, accessKey, createdAt: Date.now() });
  saveJSON("registrations", registrations);
  return { accessKey };
}

export async function createRoom(opts: {
  name: string;
  teamName: string;
  rounds: number;
  timerSeconds: number;
  maxTeams: number;
  leagueName: string;
  leaguePassword: string;
  accessKey: string;
}): Promise<{ sessionId: string; roomCode: string; state: object } | { error: string }> {
  // Validate access key
  const reg = registrations.find((r) => r.accessKey === opts.accessKey.toUpperCase());
  if (!reg) return { error: "Invalid access key" };

  const roomCode = generateCode(6);
  const sessionId = generateSessionId();

  // Build player pool (this fetches live data)
  const playerPool = await buildPlayerPool();

  const room: DraftRoom = {
    roomCode,
    status: "lobby",
    config: {
      rounds: Math.min(20, Math.max(10, opts.rounds)),
      timerSeconds: opts.timerSeconds,
      maxTeams: Math.min(20, Math.max(10, opts.maxTeams)),
      leagueName: opts.leagueName,
      leaguePassword: opts.leaguePassword,
    },
    owners: [{ id: sessionId, name: opts.name, teamName: opts.teamName, picks: [] }],
    draftOrder: [],
    commissionerId: sessionId,
    currentPick: 0,
    currentRound: 1,
    currentPickOwner: "",
    timerExpiresAt: null,
    picks: [],
    playerPool,
    playerPoolCount: playerPool.length,
    createdAt: Date.now(),
  };

  rooms.set(roomCode, room);
  saveRoom(room);
  return { sessionId, roomCode, state: getPublicState(room) };
}

export function joinRoom(
  roomCode: string,
  name: string,
  teamName: string
): { sessionId: string; roomCode: string; state: object } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.status !== "lobby") return { error: "Draft already started" };
  if (room.owners.length >= room.config.maxTeams) return { error: "Room is full" };
  if (room.owners.find((o) => o.name.toLowerCase() === name.toLowerCase()))
    return { error: "Name already taken" };

  const sessionId = generateSessionId();
  room.owners.push({ id: sessionId, name, teamName, picks: [] });
  saveRoom(room);
  broadcastToRoom(roomCode, "join", { name });
  return { sessionId, roomCode, state: getPublicState(room) };
}

export function startDraft(
  sessionId: string,
  roomCode: string
): { state: object } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.commissionerId !== sessionId) return { error: "Only commissioner can start" };
  if (room.owners.length < 2) return { error: "Need at least 2 teams" };
  if (room.status !== "lobby" && room.status !== "paused")
    return { error: "Cannot start draft in current state" };

  // If starting from lobby, set draft order (randomize if not manually set)
  if (room.status === "lobby") {
    if (room.draftOrder.length === 0) {
      room.draftOrder = room.owners.map((o) => o.id).sort(() => Math.random() - 0.5);
    }
    room.currentPickOwner = room.draftOrder[0];
  }

  room.status = "active";
  room.timerExpiresAt = Date.now() + room.config.timerSeconds * 1000;
  saveRoom(room);

  // Schedule auto-pick
  const timer = setTimeout(() => autoPick(room), room.config.timerSeconds * 1000);
  autoPickTimers.set(room.roomCode, timer);

  broadcastToRoom(roomCode, "status", getPublicState(room));
  return { state: getPublicState(room) };
}

export function pauseDraft(
  sessionId: string,
  roomCode: string
): { state: object } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.commissionerId !== sessionId) return { error: "Only commissioner can pause" };
  if (room.status !== "active") return { error: "Draft is not active" };

  room.status = "paused";
  room.timerExpiresAt = null;
  const existingTimer = autoPickTimers.get(room.roomCode);
  if (existingTimer) clearTimeout(existingTimer);
  saveRoom(room);
  broadcastToRoom(roomCode, "status", getPublicState(room));
  return { state: getPublicState(room) };
}

export function setDraftOrder(
  sessionId: string,
  roomCode: string,
  order: string[]
): { ok: boolean } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.commissionerId !== sessionId) return { error: "Only commissioner can set order" };
  if (room.status !== "lobby") return { error: "Can only set order in lobby" };
  room.draftOrder = order;
  saveRoom(room);
  return { ok: true };
}

export function makePick(
  sessionId: string,
  roomCode: string,
  playerId: number
): { state: object } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.status !== "active") return { error: "Draft is not active" };
  if (room.currentPickOwner !== sessionId) return { error: "Not your turn" };

  const playerIndex = room.playerPool.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) return { error: "Player not available" };

  const player = room.playerPool[playerIndex];
  room.playerPool.splice(playerIndex, 1);

  const owner = room.owners.find((o) => o.id === sessionId);
  if (!owner) return { error: "Owner not found" };

  owner.picks.push(player);
  room.picks.push({
    round: room.currentRound,
    pickNumber: room.currentPick,
    ownerId: sessionId,
    player,
  });

  // Advance to next pick FIRST, then broadcast with updated state
  advancePick(room);
  broadcastToRoom(roomCode, "pick", { state: getPublicState(room) });
  return { state: getPublicState(room) };
}

export function finalizeDraft(
  sessionId: string,
  roomCode: string
): { state: object } | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  if (room.commissionerId !== sessionId) return { error: "Only commissioner can finalize" };
  if (room.status !== "complete") return { error: "Draft is not complete" };

  // Generate a league ID
  const leagueId = generateCode(8).toLowerCase();
  room.leagueId = leagueId;

  // Save league data separately for the standings page
  saveJSON(`league-${leagueId}`, {
    leagueId,
    leagueName: room.config.leagueName,
    owners: room.owners.map((o) => ({
      name: o.name,
      teamName: o.teamName,
      picks: o.picks,
    })),
    draftOrder: room.draftOrder,
    completedAt: Date.now(),
  });

  saveRoom(room);
  broadcastToRoom(roomCode, "status", getPublicState(room));
  return { state: getPublicState(room) };
}

export function getRoomState(roomCode: string): object | { error: string } {
  const room = getRoom(roomCode);
  if (!room) return { error: "No draft exists" };
  return getPublicState(room);
}

export function getLeagueData(leagueId: string): object | null {
  return loadJSON(`league-${leagueId}`, null);
}

export function addSSEClient(
  roomCode: string,
  client: { send: (event: string, data: unknown) => void }
) {
  if (!sseClients.has(roomCode)) sseClients.set(roomCode, new Set());
  sseClients.get(roomCode)?.add(client);
}

export function removeSSEClient(
  roomCode: string,
  client: { send: (event: string, data: unknown) => void }
) {
  sseClients.get(roomCode)?.delete(client);
}

function getRoom(roomCode: string): DraftRoom | null {
  // Check memory first
  const cached = rooms.get(roomCode);
  if (cached) return cached;
  // Try loading from disk
  const room = loadJSON<DraftRoom | null>(`room-${roomCode}`, null);
  if (room) rooms.set(roomCode, room);
  return room;
}

// Export for admin
export function getAllRegistrations(): Registration[] {
  return registrations;
}

export function getAllRooms(): {
  roomCode: string;
  status: string;
  leagueName: string;
  owners: number;
  createdAt: number;
}[] {
  return [...rooms.values()].map((r) => ({
    roomCode: r.roomCode,
    status: r.status,
    leagueName: r.config.leagueName,
    owners: r.owners.length,
    createdAt: r.createdAt,
  }));
}
