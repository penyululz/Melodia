import "server-only"

import crypto from "crypto"
import db from "@/lib/db"

export function getCachedJson<T>(key: string): T | null {
  try {
    ensureApiCacheSchema()
    const row = db.prepare(`
      SELECT value
      FROM api_cache
      WHERE cache_key = ? AND expires_at > datetime('now')
    `).get(key) as { value: string } | null

    return row ? JSON.parse(row.value) as T : null
  } catch {
    return null
  }
}

export function setCachedJson(key: string, value: unknown, ttlSeconds: number) {
  try {
    ensureApiCacheSchema()
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
    db.prepare(`
      INSERT INTO api_cache (cache_key, value, expires_at, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(cache_key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
    `).run(key, JSON.stringify(value), expiresAt)
  } catch {
    // Cache misses should never break playback/search.
  }
}

export function makeCacheKey(prefix: string, parts: Array<string | number | null | undefined>): string {
  const hash = crypto
    .createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
  return `${prefix}:${hash}`
}

export function canSpendQuota(provider: string, cost: number, dailyBudget: number): boolean {
  return getQuotaUsage(provider) + cost <= dailyBudget
}

export function canSpendWindowQuota(provider: string, cost: number, windowSeconds: number, windowBudget: number): boolean {
  return getWindowQuotaUsage(provider, windowSeconds) + cost <= windowBudget
}

export function canSpendRequestBudget(
  provider: string,
  cost: number,
  dailyBudget: number,
  perMinuteBudget: number
): boolean {
  return (
    canSpendQuota(provider, cost, dailyBudget) &&
    canSpendWindowQuota(provider, cost, 60, perMinuteBudget)
  )
}

export function spendQuota(provider: string, cost: number) {
  try {
    ensureApiCacheSchema()
    db.prepare(`
      INSERT INTO api_quota_usage (provider, quota_date, units, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(provider, quota_date) DO UPDATE SET
        units = units + excluded.units,
        updated_at = datetime('now')
    `).run(provider, getQuotaDate(), cost)
    db.prepare(`
      INSERT INTO api_quota_events (provider, units, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(provider, cost)
    db.prepare(`
      DELETE FROM api_quota_events
      WHERE created_at < datetime('now', '-2 days')
    `).run()
  } catch {
    // Quota logging is protective but not critical.
  }
}

export function getQuotaUsage(provider: string): number {
  try {
    ensureApiCacheSchema()
    const row = db.prepare(`
      SELECT units
      FROM api_quota_usage
      WHERE provider = ? AND quota_date = ?
    `).get(provider, getQuotaDate()) as { units: number } | null
    return Number(row?.units || 0)
  } catch {
    return 0
  }
}

export function getWindowQuotaUsage(provider: string, windowSeconds: number): number {
  try {
    ensureApiCacheSchema()
    const seconds = Math.max(1, Math.min(86_400, Math.floor(windowSeconds)))
    const row = db.prepare(`
      SELECT COALESCE(SUM(units), 0) as units
      FROM api_quota_events
      WHERE provider = ? AND created_at >= datetime('now', ?)
    `).get(provider, `-${seconds} seconds`) as { units: number } | null
    return Number(row?.units || 0)
  } catch {
    return 0
  }
}

export function getQuotaStatus(provider: string, dailyBudget: number) {
  const used = getQuotaUsage(provider)
  return {
    provider,
    used,
    remaining: Math.max(0, dailyBudget - used),
    dailyBudget,
  }
}

let schemaReady = false

function ensureApiCacheSchema() {
  if (schemaReady) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_quota_usage (
      provider TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (provider, quota_date)
    );

    CREATE TABLE IF NOT EXISTS api_quota_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_api_quota_events_provider_created ON api_quota_events(provider, created_at);
  `)
  schemaReady = true
}

function getQuotaDate(): string {
  return new Date().toISOString().slice(0, 10)
}
