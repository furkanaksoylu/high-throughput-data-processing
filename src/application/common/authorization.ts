import { ForbiddenError } from "../../domain/errors";
import type { AuthRole, AuthUser } from "../../domain/auth/types";

export function requireRole(user: AuthUser, roles: AuthRole[]) {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError("insufficient permissions for this operation");
  }
}

export function ensureJobAccess(opts: {
  actor: AuthUser;
  ownerId: string | null;
}) {
  if (opts.actor.role === "admin") {
    return;
  }
  if (!opts.ownerId || opts.ownerId !== opts.actor.id) {
    throw new ForbiddenError("you can only access your own jobs");
  }
}
