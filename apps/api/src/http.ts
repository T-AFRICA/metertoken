import type { Role } from '@tronic/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  sessionId: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export const SUPERVISOR_ROLES: Role[] = ['supervisor', 'admin'];
export const isSupervisor = (u: SessionUser) => SUPERVISOR_ROLES.includes(u.role);

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  return req.user;
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = requireUser(req);
    if (!roles.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action');
  };
}
