/**
 * The company brain's database: Postgres with pgvector, reached on a URL
 * (`postgres://…`). `pglite:memory` (or `pglite:<dir>`) opens an embedded
 * PGlite instead, which the tests use; it is a dev dependency only.
 * Both answer `query(sql, params)` with the rows.
 */
export async function openBrainDb(url) {
  if (!url) return null;
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    const dir = url.slice("pglite:".length);
    const db = dir && dir !== "memory" ? await PGlite.create(dir, { extensions: { vector } }) : await PGlite.create({ extensions: { vector } });
    let queue = Promise.resolve();
    // PGlite has one connection: transactions go one after the other.
    const serial = (work) => {
      const run = queue.then(work, work);
      queue = run.catch(() => {});
      return run;
    };
    return {
      query: async (sql, params = []) => (await db.query(sql, params)).rows,
      exec: (sql) => db.exec(sql),
      transaction: (work) => serial(() => db.transaction((tx) => work({ query: async (sql, params = []) => (await tx.query(sql, params)).rows }))),
      close: () => db.close(),
    };
  }
  // Loaded only when there is a brain: an instance without one needs no node_modules at all.
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30000 });
  pool.on("error", () => {});
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    exec: (sql) => pool.query(sql),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
