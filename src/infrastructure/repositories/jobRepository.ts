import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import type {
  BulkEntity,
  BulkFormat,
  JobType,
} from '../../domain/importExport/types';
import { env } from '../config/env';
import { isPrismaErrorCode, PrismaErrorCode } from '../prisma/prismaErrors';

export type JobTotals = {
  read: number;
  valid: number;
  failed: number;
  written: number;
};

export type BulkJobRow = {
  id: string;
  type: JobType;
  entity: BulkEntity;
  format: BulkFormat;
  gzip: boolean;
  status: string;
  input_path: string | null;
  output_path: string | null;
  params: Record<string, unknown> | null;
  totals: JobTotals;
  created_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type IdempotencyReservation = {
  jobId: string;
  entity: BulkEntity | null;
  format: BulkFormat | null;
  requestHash: string | null;
};

const ZERO_TOTALS: JobTotals = { read: 0, valid: 0, failed: 0, written: 0 };

function mapJobRow(row: any): BulkJobRow {
  return {
    id: row.id,
    type: row.type as JobType,
    entity: row.entity as BulkEntity,
    format: row.format as BulkFormat,
    gzip: row.gzip,
    status: row.status,
    input_path: row.inputPath,
    output_path: row.outputPath,
    params: (row.params as Record<string, unknown> | null) ?? null,
    totals: (row.totals as JobTotals) ?? ZERO_TOTALS,
    created_by: row.createdBy,
    last_error: row.lastError,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

export async function createImportJob(input: {
  id?: string;
  entity: BulkEntity;
  format: BulkFormat;
  inputPath: string;
  gzip: boolean;
  createdBy: string;
}): Promise<string> {
  const id = input.id ?? randomUUID();

  await prisma.bulkJob.create({
    data: {
      id,
      type: 'import',
      entity: input.entity,
      format: input.format,
      status: 'queued',
      inputPath: input.inputPath,
      gzip: input.gzip,
      createdBy: input.createdBy,
      totals: ZERO_TOTALS as Prisma.InputJsonValue,
    },
  });

  return id;
}

export async function createExportJob(input: {
  entity: BulkEntity;
  format: BulkFormat;
  params: Record<string, unknown>;
  createdBy: string;
}): Promise<string> {
  const id = randomUUID();

  await prisma.bulkJob.create({
    data: {
      id,
      type: 'export',
      entity: input.entity,
      format: input.format,
      status: 'queued',
      params: input.params as Prisma.InputJsonValue,
      createdBy: input.createdBy,
      totals: ZERO_TOTALS as Prisma.InputJsonValue,
    },
  });

  return id;
}

export async function findJobById(
  jobId: string,
  type?: JobType,
): Promise<BulkJobRow | null> {
  const row = await prisma.bulkJob.findFirst({
    where: {
      id: jobId,
      ...(type ? { type } : {}),
    },
  });

  return row ? mapJobRow(row) : null;
}

export async function markJobRunning(jobId: string) {
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: {
      status: 'running',
      startedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markJobCompleted(
  jobId: string,
  input: { totals: JobTotals; outputPath?: string },
) {
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      outputPath: input.outputPath ?? undefined,
      totals: input.totals as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

export async function markJobFailed(jobId: string, lastError: string) {
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      lastError,
    },
  });
}

export async function updateJobTotals(jobId: string, totals: JobTotals) {
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: {
      totals: totals as Prisma.InputJsonValue,
    },
  });
}

export async function deleteJobErrors(jobId: string) {
  await prisma.bulkJobError.deleteMany({ where: { jobId } });
}

export async function createJobError(input: {
  jobId: string;
  line: number | null;
  externalId: string | null;
  code: string;
  errors: Record<string, unknown>[];
  raw: unknown;
}) {
  await prisma.bulkJobError.create({
    data: {
      jobId: input.jobId,
      line: input.line,
      externalId: input.externalId,
      code: input.code,
      errors: input.errors as Prisma.InputJsonValue,
      raw:
        input.raw == null
          ? Prisma.JsonNull
          : (input.raw as Prisma.InputJsonValue),
    },
  });
}

export async function reserveImportIdempotencyKey(input: {
  key: string;
  createdBy: string;
  entity: BulkEntity;
  format: BulkFormat;
  requestHash: string;
  candidateJobId?: string;
}) {
  const {
    key,
    createdBy,
    entity,
    format,
    requestHash,
    candidateJobId = randomUUID(),
  } = input;

  const where = { key_createdBy: { key, createdBy } } as const;

  const select = {
    jobId: true,
    entity: true,
    format: true,
    requestHash: true,
  };

  // First writer wins: try to create the reservation
  const created = await prisma.importIdempotency
    .create({
      data: {
        key,
        createdBy,
        jobId: candidateJobId,
        entity,
        format,
        requestHash,
      },
      select,
    })
    .catch((err) => {
      if (isPrismaErrorCode(err, PrismaErrorCode.UniqueConstraint)) {
        return null; // expected: someone else already created it
      }
      throw err;
    });

  if (created) {
    return {
      jobId: created.jobId,
      isOwner: true,
      entity: created.entity as BulkEntity | null,
      format: created.format as BulkFormat | null,
      requestHash: created.requestHash,
    };
  }

  // Someone else won the race → read existing reservation
  const existing = await prisma.importIdempotency.findUnique({
    where,
    select,
  });

  if (!existing) {
    throw new Error('Idempotency reservation lost during race');
  }

  return {
    jobId: existing.jobId,
    isOwner: false,
    entity: existing.entity as BulkEntity | null,
    format: existing.format as BulkFormat | null,
    requestHash: existing.requestHash,
  };
}

export async function releaseImportIdempotencyKey(input: {
  key: string;
  createdBy: string;
}) {
  await prisma.importIdempotency.deleteMany({
    where: {
      key: input.key,
      createdBy: input.createdBy,
    },
  });
}

export async function queuedImportJobIds(): Promise<string[]> {
  const rows = await prisma.bulkJob.findMany({
    where: { status: 'queued', type: 'import' },
    select: { id: true },
  });

  return rows.map((r) => r.id);
}

export async function queuedExportJobIds(): Promise<string[]> {
  const rows = await prisma.bulkJob.findMany({
    where: { status: 'queued', type: 'export' },
    select: { id: true },
  });

  return rows.map((r) => r.id);
}

export async function markStaleRunningJobsFailed() {
  const cutoff = new Date(Date.now() - env.STALE_JOB_TIMEOUT_MS);

  const result = await prisma.bulkJob.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: cutoff },
    },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      lastError: 'stale running job recovered',
    },
  });

  return result.count;
}
