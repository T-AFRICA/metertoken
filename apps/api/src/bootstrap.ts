import type { FastifyBaseLogger } from 'fastify';
import { writeAudit } from './audit';
import type { Config } from './config';
import type { Db } from './db';
import { hashPassword } from './routes/auth';
import { SELF_SERVICE_USERNAME } from './services/customers';

/** Creates the first admin from BOOTSTRAP_ADMIN_* when the users table is empty. */
export async function bootstrap(cfg: Config, db: Db, log: FastifyBaseLogger) {
  const users = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE username <> $1', [SELF_SERVICE_USERNAME])).rows[0]?.n ?? 0);
  if (users === 0) {
    if (!cfg.BOOTSTRAP_ADMIN_USERNAME || !cfg.BOOTSTRAP_ADMIN_PASSWORD) {
      log.warn('No users exist. Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD and restart to create the first admin.');
    } else if (cfg.BOOTSTRAP_ADMIN_PASSWORD.length < 10) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters');
    } else {
      await db.tx(async (q) => {
        const id = (
          await q.query<{ id: string }>(
            `INSERT INTO users (username, display_name, role, password_hash) VALUES ($1, 'Administrator', 'admin', $2) RETURNING id`,
            [cfg.BOOTSTRAP_ADMIN_USERNAME, await hashPassword(cfg.BOOTSTRAP_ADMIN_PASSWORD!)],
          )
        ).rows[0]!.id;
        await writeAudit(q, { actorId: null, action: 'user.bootstrap_admin', entity: 'user', entityId: id });
      });
      log.warn('First admin created from BOOTSTRAP_ADMIN_*. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.');
    }
  }

  if (cfg.SEED_SAMPLE_TARIFF) {
    const tariffs = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tariffs')).rows[0]?.n ?? 0);
    if (tariffs === 0) {
      // SAMPLE ONLY: a flat rate with percentage charges, for development. Replace before real use.
      await db.tx(async (q) => {
        const t = (
          await q.query<{ id: string }>(`INSERT INTO tariffs (code, name, currency) VALUES ($1, 'SAMPLE tariff – replace before use', $2) RETURNING id`, [
            cfg.DEFAULT_TARIFF_CODE,
            cfg.CURRENCY,
          ])
        ).rows[0]!.id;
        await q.query(
          `INSERT INTO tariff_versions (tariff_id, base_rate, percent_charges, fixed_charges, status, note, approved_at)
           VALUES ($1, '292', $2, '[]', 'active', 'Development sample, not a real tariff', now())`,
          [t, JSON.stringify([{ name: 'VAT 18%', percent: '18' }, { name: 'Levy 3%', percent: '3' }, { name: 'Levy 1%', percent: '1' }])],
        );
        await writeAudit(q, { actorId: null, action: 'tariff.sample_seeded', entity: 'tariff', entityId: t });
      });
      log.warn('Seeded a SAMPLE tariff for development. Replace it in Admin → Tariffs before real use.');
    }
  }
}
