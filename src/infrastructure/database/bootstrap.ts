import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../observability/logger';
import { prisma } from '../prisma/client';
import { toErrorMessage } from '../../shared/utils/errorMessage';
import { isPrismaErrorCode, PrismaErrorCode } from '../prisma/prismaErrors';

export async function ensureInitialSuperAdmin() {
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const passwordHash = await bcrypt.hash(
          env.SUPER_ADMIN_PASSWORD,
          env.SALT_ROUNDS,
        );

        try {
          await tx.authUser.create({
            data: {
              id: randomUUID(),
              email: env.SUPER_ADMIN_EMAIL.toLowerCase(),
              name: env.SUPER_ADMIN_NAME.trim(),
              passwordHash,
              role: 'admin',
              active: true,
            },
          });

          return true;
        } catch (error: unknown) {
          if (isPrismaErrorCode(error, PrismaErrorCode.UniqueConstraint)) {
            return false;
          }

          throw error;
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (created) {
      logger.warn({
        msg: 'super_admin_bootstrapped',
        email: env.SUPER_ADMIN_EMAIL.toLowerCase(),
        note: 'Change SUPER_ADMIN_PASSWORD after first login.',
      });
    }
  } catch (error) {
    throw new Error(toErrorMessage(error, 'super admin bootstrap failed'));
  }
}
