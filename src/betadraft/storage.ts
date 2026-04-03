// Persistent JSON storage using Railway volume at /app/data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), "data");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name: string): string {
  return join(DATA_DIR, `${name}.json`);
}

export function loadJSON<T>(name: string, fallback: T): T {
  const fp = filePath(name);
  if (!existsSync(fp)) return fallback;
  try {
    return JSON.parse(readFileSync(fp, "utf-8"));
  } catch {
    return fallback;
  }
}

export function saveJSON<T>(name: string, data: T): void {
  writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}
