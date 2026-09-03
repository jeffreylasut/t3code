/**
 * Provider rate-limit history contracts.
 *
 * Claude (`rate_limit_event`) and Codex (`account/rateLimits/updated`) both
 * push live rate-limit snapshots over their session protocols, already
 * forwarded to clients as the `account.rate-limits.updated` runtime event.
 * That event is push-only and carries no history — a client that opens a
 * fresh session sees nothing until the provider happens to report again.
 *
 * These contracts cover the second half: the server persists every snapshot
 * per provider instance (`packages/server/src/persistence/Migrations/048_ProviderRateLimitSnapshots.ts`)
 * so a client can ask "how has this account's usage trended" without having
 * kept a live connection open the whole time.
 *
 * @module providerRateLimits
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * One window's reading at one instant. `windowKey` is provider-defined
 * (Claude: `five_hour` | `seven_day` | `seven_day_opus` | `seven_day_sonnet`
 * | `overage`; Codex: `primary` | `secondary`) and left open rather than a
 * closed union so a provider that adds or renames a window does not need a
 * contract change to keep decoding.
 */
export const ProviderRateLimitSnapshot = Schema.Struct({
  windowKey: TrimmedNonEmptyString,
  status: Schema.NullOr(Schema.String),
  usedPercent: Schema.NullOr(Schema.Number),
  resetsAt: Schema.NullOr(Schema.DateTimeUtc),
  capturedAt: Schema.DateTimeUtc,
});
export type ProviderRateLimitSnapshot = typeof ProviderRateLimitSnapshot.Type;

export const ProviderRateLimitHistoryInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  /** How far back to read. Server clamps to a sane maximum. */
  windowMs: NonNegativeInt,
});
export type ProviderRateLimitHistoryInput = typeof ProviderRateLimitHistoryInput.Type;

/** One window's samples across the requested range, latest first. */
export const ProviderRateLimitWindowHistory = Schema.Struct({
  windowKey: TrimmedNonEmptyString,
  latest: ProviderRateLimitSnapshot,
  samples: Schema.Array(ProviderRateLimitSnapshot),
});
export type ProviderRateLimitWindowHistory = typeof ProviderRateLimitWindowHistory.Type;

export const ProviderRateLimitHistory = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  readAt: Schema.DateTimeUtc,
  windows: Schema.Array(ProviderRateLimitWindowHistory),
});
export type ProviderRateLimitHistory = typeof ProviderRateLimitHistory.Type;
