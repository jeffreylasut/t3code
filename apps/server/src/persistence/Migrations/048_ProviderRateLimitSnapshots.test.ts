import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("048_ProviderRateLimitSnapshots", (it) => {
  it.effect("creates the provider rate limit snapshots table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* runMigrations({ toMigrationInclusive: 48 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(provider_rate_limit_snapshots)
      `;
      const columnNames = columns.map((column) => column.name);

      assert.deepEqual(columnNames, [
        "id",
        "provider_instance_id",
        "driver",
        "window_key",
        "status",
        "used_percent",
        "resets_at",
        "captured_at",
        "raw_json",
      ]);

      yield* sql`
        INSERT INTO provider_rate_limit_snapshots
          (provider_instance_id, driver, window_key, status, used_percent, resets_at, captured_at, raw_json)
        VALUES
          ('claude_personal', 'claude', 'five_hour', 'allowed', 42.5, '2026-09-03T12:00:00.000Z', '2026-09-03T10:00:00.000Z', '{}')
      `;

      const rows = yield* sql<{ readonly window_key: string; readonly used_percent: number }>`
        SELECT window_key, used_percent FROM provider_rate_limit_snapshots
      `;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.window_key, "five_hour");
      assert.equal(rows[0]?.used_percent, 42.5);
    }),
  );
});
