import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import type { AuthRole, AuthUser } from '../../domain/auth/types';

export type AuthUserRow = AuthUser & {
  password_hash: string;
};

function authClient(tx?: Prisma.TransactionClient) {
  return tx ?? prisma;
}

export async function createAuthUser(
  input: {
    email: string;
    name: string;
    passwordHash: string;
    role: AuthRole;
  },
  tx?: Prisma.TransactionClient,
): Promise<AuthUser> {
  const row = await authClient(tx).authUser.create({
    data: {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role,
      active: true,
    },
  });

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AuthRole,
    active: row.active,
  };
}

export async function findAuthUserByEmail(
  email: string,
): Promise<AuthUserRow | null> {
  const row = await prisma.authUser.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AuthRole,
    active: row.active,
    password_hash: row.passwordHash,
  };
}

export async function findAuthUserById(id: string): Promise<AuthUser | null> {
  const row = await prisma.authUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AuthRole,
    active: row.active,
  };
}
