// MVP persistence: plain JSON files. No DB.
// LIMITATION: on Vercel serverless the filesystem is ephemeral — writes fall
// back to os.tmpdir() and may not survive across invocations. For production
// shareable report links, move to Vercel Blob or KV (v0.2).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Report } from "./types";

export const MAX_AUDITS_PER_DAY = 3;

function dataDir(): string {
  if (process.env.DATA_DIR) {
    fs.mkdirSync(path.join(process.env.DATA_DIR, "reports"), { recursive: true });
    return process.env.DATA_DIR;
  }
  const local = path.join(process.cwd(), "data");
  try {
    fs.mkdirSync(path.join(local, "reports"), { recursive: true });
    fs.accessSync(local, fs.constants.W_OK);
    return local;
  } catch {
    // Read-only FS (e.g. Vercel) -> ephemeral tmp storage
    const tmp = path.join(os.tmpdir(), "ai-visibility-fix-engine");
    fs.mkdirSync(path.join(tmp, "reports"), { recursive: true });
    return tmp;
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/** Only allow safe report ids (prevents path traversal). */
export function safeId(id: string): boolean {
  return /^[a-z0-9]{6,32}$/i.test(id);
}

export function makeId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toLowerCase();
}

export function saveReport(report: Omit<Report, "id" | "createdAt">): Report {
  const full: Report = {
    ...report,
    id: makeId(),
    createdAt: new Date().toISOString(),
  };
  writeJson(path.join(dataDir(), "reports", `${full.id}.json`), full);
  return full;
}

export function getReport(id: string): Report | null {
  if (!safeId(id)) return null;
  const file = path.join(dataDir(), "reports", `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson<Report | null>(file, null);
}

export function addEmail(email: string, reportId: string): void {
  const file = path.join(dataDir(), "emails.json");
  const list = readJson<{ email: string; reportId: string; at: string }[]>(file, []);
  list.push({ email, reportId, at: new Date().toISOString() });
  writeJson(file, list);
}

// --- rate limiting: 3 audits/day per IP (file-backed; ephemeral on Vercel) ---
interface RateState {
  [key: string]: { count: number; date: string };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkAndIncrementRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
} {
  const file = path.join(dataDir(), "ratelimit.json");
  const today = new Date().toISOString().slice(0, 10);
  const state = readJson<RateState>(file, {});
  const key = `${ip}|${today}`;
  const entry = state[key] ?? { count: 0, date: today };
  if (entry.count >= MAX_AUDITS_PER_DAY) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  state[key] = entry;
  writeJson(file, state);
  return { allowed: true, remaining: MAX_AUDITS_PER_DAY - entry.count };
}
