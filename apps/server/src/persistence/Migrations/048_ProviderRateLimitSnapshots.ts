/**
 * Adds `provider_rate_limit_snapshots`, an append-only log of the rate-limit
 * windows providers report (Claude's `rate_limit_event`, Codex's
 * `account/rateLimits/updated`). Each row is one window's reading at one
 * instant, keyed by the configured provider instance so usage history can be
 * charted per account and providers can report several windows at once (e.g.
 * Claude's five-hour and seven-day windows) without colliding.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_rate_limit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_instance_id TEXT NOT NULL,
      driver TEXT NOT NULL,
      window_key TEXT NOT NULL,
      status TEXT,
      used_percent REAL,
      resets_at TEXT,
      captured_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_rate_limit_snapshots_lookup
    ON provider_rate_limit_snapshots(provider_instance_id, window_key, captured_at)
  `;
});
