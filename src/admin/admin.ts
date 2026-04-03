// Admin authentication and API
import { randomBytes } from "crypto";
import { getAllRegistrations, getAllRooms } from "../betadraft/draftroom";
import { loadJSON, saveJSON } from "../betadraft/storage";
import type { FeedbackEntry } from "../betadraft/types";

// Simple admin credentials (in production, use env vars)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "ncaa2026";

// Session tokens
const sessions = new Set<string>();

// Feedback storage
const feedback: FeedbackEntry[] = loadJSON<FeedbackEntry[]>("feedback", []);

export function authenticate(
  username: string,
  password: string
): { token: string } | { error: string } {
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return { error: "Invalid credentials" };
  }
  const token = randomBytes(32).toString("hex");
  sessions.add(token);
  return { token };
}

export function isAuthenticated(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(/admin_token=([a-f0-9]+)/);
  if (!match) return false;
  return sessions.has(match[1]);
}

export function getAuthToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/admin_token=([a-f0-9]+)/);
  return match ? match[1] : null;
}

export function addFeedback(entry: Omit<FeedbackEntry, "createdAt">): void {
  feedback.push({ ...entry, createdAt: Date.now() });
  saveJSON("feedback", feedback);
}

export function getFeedback(): FeedbackEntry[] {
  return feedback;
}

export function getAdminDashboardData() {
  return {
    registrations: getAllRegistrations(),
    rooms: getAllRooms(),
    feedback: getFeedback(),
  };
}
