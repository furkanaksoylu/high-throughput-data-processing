import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { toErrorMessage } from '../../shared/utils/errorMessage';
import { enqueueBulkJob } from '../../infrastructure/queue/bulkQueue';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../domain/errors';
import type { AuthUser } from '../../domain/auth/types';
import type { BulkEntity, BulkFormat } from '../../domain/importExport/types';
import { ensureJobAccess } from '../common/authorization';
import type { ImportErrorRow } from './importTypes';
import {
  createImportJob,
  findJobById,
  releaseImportIdempotencyKey,
  reserveImportIdempotencyKey,
} from '../../infrastructure/repositories/jobRepository';
import {
  downloadImportFile,
  storeIncomingImportFile,
} from '../../infrastructure/storage/importStorage';
import { prisma } from '../../infrastructure/prisma/client';
import { logger } from '../../infrastructure/observability/logger';

// URL construction intentionally lives in the route layer (importRoutes.ts).
// The service returns only the job ID and idempotency flag.
export type CreateImportResult = {
  jobId: string;
  idempotent: boolean;
};

type ImportIdempotencyFingerprint = {
  entity: BulkEntity;
  format: BulkFormat;
  requestHash: string;
};

type ReservationState = {
  jobId: string;
  idempotent: boolean;
  hasReservation: boolean;
};

const IDEMPOTENCY_WAIT_TIMEOUT_MS = 5000;
const IDEMPOTENCY_WAIT_POLL_MS = 100;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUploadRequestHash(input: {
  entity: BulkEntity;
  format: BulkFormat;
  fileSha256: string;
}): string {
  return sha256(`upload|${input.entity}|${input.format}|${input.fileSha256}`);
}

function buildUrlRequestHash(input: {
  entity: BulkEntity;
  format: BulkFormat;
  url: string;
}): string {
  const normalized = new URL(input.url).toString();
  return sha256(`url|${input.entity}|${input.format}|${normalized}`);
}

function assertIdempotentRequestMatches(
  reserved: {
    entity: BulkEntity | null;
    format: BulkFormat | null;
    requestHash: string | null;
  },
  expected: ImportIdempotencyFingerprint,
) {
  if (reserved.entity && reserved.entity !== expected.entity) {
    throw new ConflictError(
      'Idempotency-Key is already used for a different resource',
    );
  }
  if (reserved.format && reserved.format !== expected.format) {
    throw new ConflictError(
      'Idempotency-Key is already used for a different format',
    );
  }
  if (!reserved.requestHash) {
    throw new ConflictError(
      'Idempotency-Key exists without request fingerprint. Use a new Idempotency-Key.',
    );
  }
  if (reserved.requestHash !== expected.requestHash) {
    throw new ConflictError(
      'Idempotency-Key is already used for a different payload',
    );
  }
}

async function releaseReservationIfNeeded(input: {
  reservation?: ReservationState;
  idempotencyKey?: string;
  actorId: string;
}) {
  if (!input.reservation?.hasReservation || !input.idempotencyKey) return;
  await releaseImportIdempotencyKey({
    key: input.idempotencyKey,
    createdBy: input.actorId,
  });
}

async function cleanupPathIfNeeded(path?: string, enabled = false) {
  if (!enabled || !path) return;
  try {
    await rm(path, { force: true });
  } catch (error) {
    logger.error({
      msg: 'import_temp_cleanup_failed',
      path,
      err: toErrorMessage(error, 'unknown cleanup error'),
    });
  }
}

async function enqueueNewImportJob(input: {
  jobId: string;
  entity: BulkEntity;
  format: BulkFormat;
  inputPath: string;
  gzip: boolean;
  createdBy: string;
}): Promise<string> {
  const id = await createImportJob({
    id: input.jobId,
    entity: input.entity,
    format: input.format,
    inputPath: input.inputPath,
    gzip: input.gzip,
    createdBy: input.createdBy,
  });

  try {
    await enqueueBulkJob({ name: 'processImport', jobId: id });
  } catch (error) {
    logger.error({
      msg: 'import_job_enqueue_failed',
      jobId: id,
      err: toErrorMessage(error, 'unknown queue enqueue error'),
    });
  }

  return id;
}

async function reserveImportSubmission(input: {
  key?: string;
  actor: AuthUser;
  candidateJobId: string;
  fingerprint: ImportIdempotencyFingerprint;
}): Promise<ReservationState> {
  if (!input.key) {
    return {
      jobId: input.candidateJobId,
      idempotent: false,
      hasReservation: false,
    };
  }

  const deadline = Date.now() + IDEMPOTENCY_WAIT_TIMEOUT_MS;

  while (true) {
    const reservation = await reserveImportIdempotencyKey({
      key: input.key,
      createdBy: input.actor.id,
      entity: input.fingerprint.entity,
      format: input.fingerprint.format,
      requestHash: input.fingerprint.requestHash,
      candidateJobId: input.candidateJobId,
    });

    if (reservation.isOwner) {
      return {
        jobId: reservation.jobId,
        idempotent: false,
        hasReservation: true,
      };
    }

    assertIdempotentRequestMatches(reservation, input.fingerprint);

    const existingJob = await findJobById(reservation.jobId, 'import');
    if (existingJob) {
      return {
        jobId: reservation.jobId,
        idempotent: true,
        hasReservation: false,
      };
    }

    if (Date.now() >= deadline) {
      throw new ConflictError(
        'Idempotency-Key is currently in use. Retry the same request shortly.',
      );
    }

    await sleep(IDEMPOTENCY_WAIT_POLL_MS);
  }
}

export async function createImportJobFromUpload(input: {
  actor: AuthUser;
  entity: BulkEntity;
  format: BulkFormat;
  fileStream: NodeJS.ReadableStream;
  idempotencyKey?: string;
}): Promise<CreateImportResult> {
  const candidateJobId = randomUUID();
  let reservation: ReservationState | undefined;
  let uploadPath: string | undefined;
  let shouldCleanupUpload = false;

  try {
    const uploaded = await storeIncomingImportFile({
      jobId: candidateJobId,
      source: input.fileStream,
      entity: input.entity,
      format: input.format,
    });
    uploadPath = uploaded.path;
    shouldCleanupUpload = true;

    reservation = await reserveImportSubmission({
      key: input.idempotencyKey,
      actor: input.actor,
      candidateJobId,
      fingerprint: {
        entity: input.entity,
        format: input.format,
        requestHash: buildUploadRequestHash({
          entity: input.entity,
          format: input.format,
          fileSha256: uploaded.sha256,
        }),
      },
    });

    if (reservation.idempotent) {
      return { jobId: reservation.jobId, idempotent: true };
    }

    const jobId = await enqueueNewImportJob({
      jobId: reservation.jobId,
      entity: input.entity,
      format: input.format,
      inputPath: uploaded.path,
      gzip: uploaded.gzip,
      createdBy: input.actor.id,
    });

    shouldCleanupUpload = false;
    return { jobId, idempotent: false };
  } catch (error) {
    await releaseReservationIfNeeded({
      reservation,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actor.id,
    });
    throw error;
  } finally {
    await cleanupPathIfNeeded(uploadPath, shouldCleanupUpload);
  }
}

export async function createImportJobFromUrl(input: {
  actor: AuthUser;
  entity: BulkEntity;
  format: BulkFormat;
  url: string;
  idempotencyKey?: string;
}): Promise<CreateImportResult> {
  const candidateJobId = randomUUID();
  const reservation = await reserveImportSubmission({
    key: input.idempotencyKey,
    actor: input.actor,
    candidateJobId,
    fingerprint: {
      entity: input.entity,
      format: input.format,
      requestHash: buildUrlRequestHash({
        entity: input.entity,
        format: input.format,
        url: input.url,
      }),
    },
  });

  if (reservation.idempotent) {
    return { jobId: reservation.jobId, idempotent: true };
  }

  let downloadedPath: string | undefined;
  let shouldCleanupDownload = false;

  try {
    const downloaded = await downloadImportFile({
      jobId: reservation.jobId,
      url: input.url,
      entity: input.entity,
      format: input.format,
    });
    downloadedPath = downloaded.path;
    shouldCleanupDownload = true;

    const jobId = await enqueueNewImportJob({
      jobId: reservation.jobId,
      entity: input.entity,
      format: input.format,
      inputPath: downloaded.path,
      gzip: downloaded.gzip,
      createdBy: input.actor.id,
    });

    shouldCleanupDownload = false;
    return { jobId, idempotent: false };
  } catch (error) {
    await releaseReservationIfNeeded({
      reservation,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actor.id,
    });
    throw error;
  } finally {
    await cleanupPathIfNeeded(downloadedPath, shouldCleanupDownload);
  }
}

export async function getImportJobView(input: {
  actor: AuthUser;
  jobId: string;
}) {
  const job = await findJobById(input.jobId, 'import');
  if (!job) throw new NotFoundError('import job not found');

  ensureJobAccess({ actor: input.actor, ownerId: job.created_by });

  return {
    id: job.id,
    type: job.type,
    entity: job.entity,
    format: job.format,
    status: job.status,
    totals: job.totals,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    lastError: job.last_error,
    hasErrors: Number(job.totals.failed ?? 0) > 0,
  };
}

export async function* iterateImportJobErrors(input: {
  actor: AuthUser;
  jobId: string;
}) {
  const job = await findJobById(input.jobId, 'import');
  if (!job) throw new NotFoundError('import job not found');
  ensureJobAccess({ actor: input.actor, ownerId: job.created_by });

  const batchSize = 2000;
  let afterCreatedAt: Date | null = null;
  let afterId: string | null = null;

  while (true) {
    const rows: ImportErrorRow[] = await prisma.bulkJobError.findMany({
      where: {
        jobId: input.jobId,
        ...(afterCreatedAt && afterId
          ? {
              OR: [
                { createdAt: { gt: afterCreatedAt } },
                { createdAt: afterCreatedAt, id: { gt: afterId } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        jobId: true,
        line: true,
        externalId: true,
        code: true,
        errors: true,
        raw: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      yield JSON.stringify({
        job_id: row.jobId,
        line: row.line,
        external_id: row.externalId,
        code: row.code,
        errors: row.errors,
        raw: row.raw,
        created_at: row.createdAt.toISOString(),
      }) + '\n';
    }

    const last: ImportErrorRow = rows[rows.length - 1];
    afterCreatedAt = last.createdAt;
    afterId = last.id;
  }
}
