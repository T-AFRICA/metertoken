import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import { cookieSecure } from '../config';
import type { AppContext } from '../context';
import { HttpError, requireUser } from '../http';
import { randomToken, sha256 } from '../security';

export const SESSION_COOKIE = 'tsp_session';
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export const hashPassword = (password: string) => hash(password);

/** Loads the session user for every request and enforces CSRF on state-changing calls. */
export function registerSessionHooks(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const row = (
        await ctx.db.query(
          `SELECT s.id, s.csrf_token, u.id AS user_id, u.username, u.display_name, u.role
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
          [sha256(raw)],
        )
      ).rows[0];
      if (row) {
        req.user = {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
          sessionId: row.id,
          csrfToken: row.csrf_token,
        };
      }
    }
    const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Customer routes carry their own session and CSRF check (see routes/customer.ts).
    if (stateChanging && req.user && !req.url.startsWith('/api/customer/') && req.headers['x-csrf-token'] !== req.user.csrfToken) {
      throw new HttpError(403, 'CSRF', 'Security token missing or expired; reload the page');
    }
  });
}

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const failures = new Map<string, { count: number; first: number }>();
  // Verifying against a dummy hash keeps response time similar for unknown usernames.
  const dummyHash = hash(randomToken());

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) }).parse(req.body);
    const key = body.username.toLowerCase();
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.first < LOCKOUT_MS) {
      throw new HttpError(429, 'LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
    }

    const user = (
      await ctx.db.query('SELECT id, username, display_name, role, password_hash FROM users WHERE lower(username) = $1 AND active', [key])
    ).rows[0];
    const ok = await verify(user?.password_hash ?? (await dummyHash), body.password).catch(() => false);
    if (!user || !ok) {
      const cur = f && Date.now() - f.first < LOCKOUT_MS ? f : { count: 0, first: Date.now() };
      failures.set(key, { ...cur, count: cur.count + 1 });
      await audit(ctx.db, { actorId: user?.id ?? null, action: 'auth.login_failed', detail: { username: key, ip: req.ip } });
      throw new HttpError(401, 'INVALID_LOGIN', 'Wrong username or password');
    }
    failures.delete(key);

    const raw = randomToken();
    const csrfToken = randomToken();
    const expires = new Date(Date.now() + ctx.cfg.SESSION_TTL_HOURS * 3600 * 1000);
    await ctx.db.query('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)', [sha256(raw), user.id, csrfToken, expires]);
    await ctx.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await audit(ctx.db, { actorId: user.id, action: 'auth.login', detail: { ip: req.ip } });

    reply.setCookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure(ctx.cfg),
      path: '/',
      expires,
    });
    return { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role }, csrfToken };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const user = requireUser(req);
    await ctx.db.query('DELETE FROM sessions WHERE id = $1', [user.sessionId]);
    await audit(ctx.db, { actorId: user.id, action: 'auth.logout' });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const user = requireUser(req);
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
      csrfToken: user.csrfToken,
      adapterMode: ctx.adapter.mode,
      currency: ctx.cfg.CURRENCY,
    };
  });
}
