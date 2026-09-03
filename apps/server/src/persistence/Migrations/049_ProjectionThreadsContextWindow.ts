/**
 * Adds the last-known context-window usage to `projection_threads`, folded
 * in from each thread's `context-window.updated` activities (see
 * `ProjectionPipeline.ts`'s `thread.activity-appended` case). Lets the
 * thread list show a usage indicator per session without loading each
 * thread's full activity stream just to find its latest reading.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("context_window_used_tokens")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN context_window_used_tokens INTEGER
    `;
  }

  if (!columnNames.has("context_window_max_tokens")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN context_window_max_tokens INTEGER
    `;
  }
});
