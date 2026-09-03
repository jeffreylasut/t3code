import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("049_ProjectionThreadsContextWindow", (it) => {
  it.effect("adds nullable context-window usage columns to project threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 48 });
      yield* runMigrations({ toMigrationInclusive: 49 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const usedTokens = columns.find((column) => column.name === "context_window_used_tokens");
      const maxTokens = columns.find((column) => column.name === "context_window_max_tokens");

      assert.equal(usedTokens?.notnull, 0);
      assert.equal(maxTokens?.notnull, 0);
    }),
  );
});
