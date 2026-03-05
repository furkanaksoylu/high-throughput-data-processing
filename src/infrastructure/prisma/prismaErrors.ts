import { Prisma } from '@prisma/client';

export const PrismaErrorCode = {
  UniqueConstraint: 'P2002',
  SerializationFailure: 'P2034',
} as const;

export type PrismaErrorCodeType =
  (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

export function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export function isPrismaErrorCode(
  error: unknown,
  code: PrismaErrorCodeType,
): boolean {
  return isPrismaKnownError(error) && error.code === code;
}
