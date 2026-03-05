import bcrypt from 'bcryptjs';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../domain/errors';
import type { AuthRole, AuthUser } from '../../domain/auth/types';
import {
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
} from '../../infrastructure/repositories/authRepository';
import {
  isPrismaErrorCode,
  PrismaErrorCode,
} from '../../infrastructure/prisma/prismaErrors';
import { env } from '../../infrastructure/config/env';

export async function registerAuthUser(input: {
  email: string;
  name: string;
  password: string;
  role?: AuthRole;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const password = input.password;

  if (!email || !name || !password) {
    throw new BadRequestError('email, name and password are required');
  }
  if (password.length < 8) {
    throw new BadRequestError('password must be at least 8 characters');
  }
  const user = await findAuthUserByEmail(email);
  if (user) {
    throw new ConflictError('email is already registered');
  }

  const passwordHash = await bcrypt.hash(password, env.SALT_ROUNDS);

  try {
    return await createAuthUser({
      email,
      name,
      passwordHash,
      role: input.role ?? 'user',
    });
  } catch (error) {
    if (isPrismaErrorCode(error, PrismaErrorCode.UniqueConstraint)) {
      throw new ConflictError('email is already registered');
    }
    throw error;
  }
}

export async function loginAuthUser(input: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) {
    throw new BadRequestError('email and password are required');
  }

  const user = await findAuthUserByEmail(email);
  if (!user) {
    throw new UnauthorizedError('invalid credentials');
  }
  if (!user.active) {
    throw new ForbiddenError('user is inactive');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new UnauthorizedError('invalid credentials');
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
  };
}

export async function getActiveAuthUserById(
  id: string,
): Promise<AuthUser | null> {
  const user = await findAuthUserById(id);
  if (!user || !user.active) {
    return null;
  }
  return user;
}
