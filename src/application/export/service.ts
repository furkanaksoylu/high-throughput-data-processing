import { toErrorMessage } from '../../shared/utils/errorMessage';
import { enqueueBulkJob } from '../../infrastructure/queue/bulkQueue';
import { NotFoundError } from '../../domain/errors';
import type { AuthUser } from '../../domain/auth/types';
import type {
  BulkEntity,
  BulkFormat,
  ExportParams,
} from '../../domain/importExport/types';
import { ensureJobAccess } from '../common/authorization';
import {
  createExportJob,
  findJobById,
} from '../../infrastructure/repositories/jobRepository';
import { contentTypeForFormat } from './exportDto';
import { logger } from '../../infrastructure/observability/logger';
import { buildExportFileName } from '../../infrastructure/storage/importStorage';

export async function enqueueExportJob(input: {
  actor: AuthUser;
  entity: BulkEntity;
  format: BulkFormat;
  params: ExportParams;
}): Promise<{ jobId: string }> {
  const jobId = await createExportJob({
    entity: input.entity,
    format: input.format,
    params: input.params as Record<string, unknown>,
    createdBy: input.actor.id,
  });

  try {
    await enqueueBulkJob({ name: 'processExport', jobId });
  } catch (error) {
    logger.error({
      msg: 'export_job_enqueue_failed',
      jobId,
      err: toErrorMessage(error, 'unknown queue enqueue error'),
    });
  }

  return { jobId };
}

export async function getExportJobView(input: {
  actor: AuthUser;
  jobId: string;
}) {
  const job = await findJobById(input.jobId, 'export');
  if (!job) throw new NotFoundError('export job not found');

  ensureJobAccess({ actor: input.actor, ownerId: job.created_by });

  const completed = job.status === 'completed' && Boolean(job.output_path);

  return {
    id: job.id,
    type: job.type,
    entity: job.entity,
    format: job.format,
    status: job.status,
    totals: job.totals,
    params: job.params,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    lastError: job.last_error,
    hasDownload: completed,
  };
}

export async function getExportDownload(input: {
  actor: AuthUser;
  jobId: string;
}): Promise<{ path: string; fileName: string; contentType: string } | null> {
  const job = await findJobById(input.jobId, 'export');
  if (!job) throw new NotFoundError('export job not found');

  ensureJobAccess({ actor: input.actor, ownerId: job.created_by });

  if (job.status !== 'completed' || !job.output_path) return null;

  return {
    path: job.output_path,
    fileName: buildExportFileName(job.id, job.entity, job.format),
    contentType: contentTypeForFormat(job.format),
  };
}
