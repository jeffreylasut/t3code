/**
 * ProviderRateLimitSnapshotRepository - persistence for provider rate-limit
 * history.
 *
 * Claude and Codex both push live rate-limit readings over their session
 * protocols (see `ClaudeAdapter.ts`'s `rate_limit_event` handling and
 * `CodexAdapter.ts`'s `account/rateLimits/updated` handling), already
 * forwarded to clients as the push-only `account.rate-limits.updated`
 * runtime event. This repository is the write side of the second half: every
 * reading is appended here too, so a client opening a fresh session — or
 * charting usage over the last few days — can read history instead of only
 * ever seeing "whatever the provider happened to report since I connected".
 *
 * @module ProviderRateLimitSnapshotRepository
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  type ProviderInstanceId,
  type ProviderRateLimitHistory,
  type ProviderRateLimitHistoryInput,
  type ProviderRateLimitSnapshot,
} from "@t3tools/contracts";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export type ProviderRateLimitRepositoryError = PersistenceSqlError | PersistenceDecodeError;

/** Longest history a client may request. Older rows still exist; callers just can't ask for them. */
const MAX_HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Providers are inconsistent about whether "used" is a 0..1 fraction (Claude's
 * `utilization`) or a 0..100 integer (Codex's `usedPercent`). Neither SDK
 * documents the convention in a machine-checkable way, so this treats
 * anything at or below 1 as a fraction — a provider genuinely at exactly 1%
 * used is indistinguishable from 100% as a fraction, but that boundary is
 * far more likely to be "just started, ~0-1% used" in practice.
 */
export function normalizeRateLimitPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

/**
 * Providers are similarly inconsistent about unix seconds vs milliseconds.
 * Treated as seconds below this threshold (year ~2286 in milliseconds, but
 * year ~5138 in seconds) — comfortably past any real reset timestamp either
 * way, so genuine values never round-trip through the wrong branch.
 */
const SECONDS_MS_THRESHOLD = 10_000_000_000;

export function normalizeRateLimitEpochMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value < SECONDS_MS_THRESHOLD ? value * 1000 : value;
}

export interface RecordProviderRateLimitSnapshotInput {
  readonly providerInstanceId: ProviderInstanceId;
  readonly driver: string;
  readonly windowKey: string;
  readonly status: string | null;
  readonly usedPercent: number | null;
  readonly resetsAtMs: number | null;
  readonly capturedAtMs: number;
  readonly raw: unknown;
}

export class ProviderRateLimitSnapshotRepository extends Context.Service<
  ProviderRateLimitSnapshotRepository,
  {
    /** Appends one window's reading. Never updates or dedupes: history is the point. */
    readonly record: (
      input: RecordProviderRateLimitSnapshotInput,
    ) => Effect.Effect<void, ProviderRateLimitRepositoryError>;

    /** Reads history for one provider instance, grouped by window, latest first within each window. */
    readonly readHistory: (
      input: ProviderRateLimitHistoryInput,
    ) => Effect.Effect<ProviderRateLimitHistory, ProviderRateLimitRepositoryError>;
  }
>()("t3/persistence/ProviderRateLimitSnapshots/ProviderRateLimitSnapshotRepository") {}

/** Empty history, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  ProviderRateLimitSnapshotRepository,
  ProviderRateLimitSnapshotRepository.of({
    record: () => Effect.void,
    readHistory: (input) =>
      Effect.map(DateTime.now, (readAt) => ({
        providerInstanceId: input.providerInstanceId,
        readAt,
        windows: [],
      })),
  }),
);

const RateLimitRowSchema = Schema.Struct({
  windowKey: Schema.String,
  status: Schema.NullOr(Schema.String),
  usedPercent: Schema.NullOr(Schema.Number),
  resetsAt: Schema.NullOr(Schema.DateTimeUtc),
  capturedAt: Schema.DateTimeUtc,
});

const decodeRow = Schema.decodeUnknownEffect(RateLimitRowSchema);

const HistoryRequestSchema = Schema.Struct({
  providerInstanceId: Schema.String,
  sinceIso: Schema.String,
});

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readRows = SqlSchema.findAll({
    Request: HistoryRequestSchema,
    Result: Schema.Struct({
      windowKey: Schema.Unknown,
      status: Schema.Unknown,
      usedPercent: Schema.Unknown,
      resetsAt: Schema.Unknown,
      capturedAt: Schema.Unknown,
    }),
    execute: ({ providerInstanceId, sinceIso }) =>
      sql`
        SELECT
          window_key AS "windowKey",
          status,
          used_percent AS "usedPercent",
          resets_at AS "resetsAt",
          captured_at AS "capturedAt"
        FROM provider_rate_limit_snapshots
        WHERE provider_instance_id = ${providerInstanceId}
          AND captured_at >= ${sinceIso}
        ORDER BY captured_at ASC
      `,
  });

  const record: ProviderRateLimitSnapshotRepository["Service"]["record"] = (input) =>
    sql`
      INSERT INTO provider_rate_limit_snapshots (
        provider_instance_id,
        driver,
        window_key,
        status,
        used_percent,
        resets_at,
        captured_at,
        raw_json
      )
      VALUES (
        ${input.providerInstanceId},
        ${input.driver},
        ${input.windowKey},
        ${input.status},
        ${input.usedPercent},
        ${input.resetsAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(input.resetsAtMs))},
        ${DateTime.formatIso(DateTime.makeUnsafe(input.capturedAtMs))},
        ${JSON.stringify(input.raw ?? null)}
      )
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new PersistenceSqlError({
            operation: "ProviderRateLimitSnapshotRepository.record:query",
            correlation: { providerInstanceId: input.providerInstanceId },
            cause,
          }),
      ),
    );

  const readHistory: ProviderRateLimitSnapshotRepository["Service"]["readHistory"] = (input) =>
    Effect.gen(function* () {
      const readAt = yield* DateTime.now;
      const windowMs = Math.min(input.windowMs, MAX_HISTORY_WINDOW_MS);
      const sinceIso = DateTime.formatIso(DateTime.subtract(readAt, { milliseconds: windowMs }));

      const rows = yield* readRows({
        providerInstanceId: input.providerInstanceId,
        sinceIso,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceSqlError({
              operation: "ProviderRateLimitSnapshotRepository.readHistory:query",
              correlation: { providerInstanceId: input.providerInstanceId },
              cause,
            }),
        ),
      );

      const decoded: ProviderRateLimitSnapshot[] = [];
      for (const row of rows) {
        const parsed = yield* decodeRow(row).pipe(
          Effect.mapError((cause) =>
            PersistenceDecodeError.fromSchemaError(
              "ProviderRateLimitSnapshotRepository.readHistory:decodeRow",
              cause,
              { providerInstanceId: input.providerInstanceId },
            ),
          ),
        );
        decoded.push(parsed);
      }

      const byWindow = new Map<string, ProviderRateLimitSnapshot[]>();
      for (const snapshot of decoded) {
        const existing = byWindow.get(snapshot.windowKey) ?? [];
        existing.push(snapshot);
        byWindow.set(snapshot.windowKey, existing);
      }

      return {
        providerInstanceId: input.providerInstanceId,
        readAt,
        windows: [...byWindow.entries()].map(([windowKey, samples]) => ({
          windowKey,
          latest: samples[samples.length - 1]!,
          samples,
        })),
      } satisfies ProviderRateLimitHistory;
    });

  return { record, readHistory } satisfies ProviderRateLimitSnapshotRepository["Service"];
});

export const layer = Layer.effect(ProviderRateLimitSnapshotRepository, make);
