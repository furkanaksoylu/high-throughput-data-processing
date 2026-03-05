import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../../domain/errors";
import type { AuthRole, AuthUser } from "../../domain/auth/types";
import { requireRole } from "../../application/common/authorization";
import { getActiveAuthUserById } from "../../application/auth/service";

async function authenticate(request: FastifyRequest): Promise<AuthUser> {
  if (request.authUser) {
    return request.authUser;
  }

  let payload: { sub?: string };
  try {
    payload = (await request.jwtVerify()) as { sub?: string };
  } catch {
    throw new UnauthorizedError("missing or invalid token");
  }
  if (!payload?.sub) {
    throw new UnauthorizedError("invalid token payload");
  }

  const user = await getActiveAuthUserById(payload.sub);
  if (!user) {
    throw new UnauthorizedError("user is not authorized");
  }

  request.authUser = user;
  return user;
}

export function requireAuth(roles?: AuthRole[]) {
  return async function authGuard(request: FastifyRequest, _reply: FastifyReply) {
    const user = await authenticate(request);
    if (roles && roles.length > 0) {
      requireRole(user, roles);
    }
  };
}

export async function getAuthenticatedUser(request: FastifyRequest): Promise<AuthUser> {
  return authenticate(request);
}
