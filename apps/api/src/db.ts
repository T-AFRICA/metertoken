import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const pgQuery = <T>(c: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]) =>
  c.query(sql, params) as unknown as Promise<{ rows: T[] }>;

/** With a CA certificate the connection is TLS-verified against it; an sslmode in the URL would override that, so it is dropped. */
function poolConfig(databaseUrl: string, ca?: string): pg.PoolConfig {
  if (!ca) return { connectionString: databaseUrl };
  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}

/** PostgreSQL via DATABASE_URL, or embedded PGlite (a directory, or "memory://" for tests). */
export async function openDb(opts: { databaseUrl?: string; databaseCaCert?: string; pgliteDir?: string }): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool(poolConfig(opts.databaseUrl, opts.databaseCaCert));
    return {
      query: (sql, params) => pgQuery(pool, sql, params),
      exec: async (sql) => {
        await pool.query(sql);
      },
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (sql, params) => pgQuery(client, sql, params) });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const lite = new PGlite(opts.pgliteDir ?? 'memory://');
  await lite.waitReady;
  return {
    query: (sql, params) => lite.query(sql, params as unknown[]),
    exec: async (sql) => {
      await lite.exec(sql);
    },
    tx: (fn) => lite.transaction((t) => fn({ query: (sql, params) => t.query(sql, params as unknown[]) })),
    close: () => lite.close(),
  };
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(db: Db): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations(version) VALUES ('${file}');\nCOMMIT;`);
    applied.push(file);
  }
  return applied;
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code !== '23505') return false;
  return !constraint || err.constraint === constraint || Boolean(err.message?.includes(constraint));
}
