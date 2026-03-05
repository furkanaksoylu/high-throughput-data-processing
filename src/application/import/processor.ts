import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { toErrorMessage } from '../../shared/utils/errorMessage';
import type { BulkEntity } from '../../domain/importExport/types';
import { ImportErrorCode } from '../../domain/importExport/errorCodes';
import {
  validateImportRecord,
  type UserImportRecord,
  type ArticleImportRecord,
  type CommentImportRecord,
} from '../../domain/importExport/validation';
import { pool } from '../../infrastructure/database/pool';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/observability/logger';
import {
  bulkJobDurationSeconds,
  bulkJobErrors,
  bulkJobsRunning,
  bulkRecords,
} from '../../infrastructure/observability/metrics';
import {
  createJobError,
  deleteJobErrors,
  findJobById,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  updateJobTotals,
} from '../../infrastructure/repositories/jobRepository';
import {
  countStagingRows,
  deleteStagingRows,
  findAndDeleteSlugConflicts,
  stagingTableForEntity,
} from '../../infrastructure/repositories/stagingRepository';
import { streamInputRecords } from '../common/recordStream';
import {
  flushAllBuffers,
  flushArticlesBatch,
  flushCommentsBatch,
  flushUsersBatch,
  idFromRaw,
} from './batchFlusher';
import { mergeStagingRows } from './stagingMerger';
import type {
  ArticleBufferItem,
  CommentBufferItem,
  ImportProcessContext,
  ProgressTotals,
  UserBufferItem,
} from './importTypes';

const FLUSH_SIZE = env.IMPORT_FLUSH_SIZE;

function sourceStreamForJob(inputPath: string, gzip: boolean): Readable {
  const source = createReadStream(inputPath);
  return gzip ? source.pipe(createGunzip()) : source;
}

function nowInSeconds(startMs: number): number {
  return (Date.now() - startMs) / 1000;
}

function errorRate(totals: ProgressTotals): number {
  return totals.read > 0 ? Number(((totals.failed / totals.read) * 100).toFixed(2)) : 0;
}

function rowsPerSecond(read: number, startMs: number): number {
  const elapsed = nowInSeconds(startMs);
  return elapsed > 0 ? Math.round(read / elapsed) : 0;
}

function logProgress(context: ImportProcessContext, startMs: number) {
  logger.info({
    msg: 'import_progress',
    jobId: context.jobId,
    entity: context.entity,
    totals: context.totals,
    rows_per_sec: rowsPerSecond(context.totals.read, startMs),
    error_rate: errorRate(context.totals),
  });
}

function logCompleted(context: ImportProcessContext, startMs: number) {
  const duration = nowInSeconds(startMs);
  logger.info({
    msg: 'import_job_completed',
    jobId: context.jobId,
    entity: context.entity,
    totals: context.totals,
    duration_sec: Math.round(duration),
    rows_per_sec: duration > 0 ? Math.round(context.totals.read / duration) : 0,
    error_rate: errorRate(context.totals),
  });
}

export async function processImportJob(jobId: string) {
  const job = await findJobById(jobId, 'import');
  if (!job) return;

  const entity = job.entity as BulkEntity;
  const stagingTable = stagingTableForEntity(entity);
  const startMs = Date.now();
  let lastLogMs = startMs;

  const totals: ProgressTotals = { read: 0, valid: 0, failed: 0, written: 0 };

  bulkJobsRunning.inc(1);
  const timer = bulkJobDurationSeconds.startTimer({ entity, type: 'import' });
  await markJobRunning(jobId);

  const copyClient = await pool.connect();
  const context: ImportProcessContext = { copyClient, jobId, entity, totals };

  try {
    // Clear any state from a previous crashed attempt
    await Promise.all([deleteStagingRows(stagingTable, jobId), deleteJobErrors(jobId)]);
    await updateJobTotals(jobId, totals);

    const recordStream = streamInputRecords({
      source: sourceStreamForJob(job.input_path as string, job.gzip),
      format: job.format,
    });

    const buffers = {
      users: [] as UserBufferItem[],
      articles: [] as ArticleBufferItem[],
      comments: [] as CommentBufferItem[],
    };

    for await (const entry of recordStream) {
      totals.read += 1;

      if (entry.parseError) {
        totals.failed += 1;
        bulkRecords.inc({ entity, status: 'parse_error' });
        bulkJobErrors.inc({ entity, code: ImportErrorCode.PARSE_ERROR });
        await createJobError({
          jobId,
          line: entry.line,
          externalId: null,
          code: ImportErrorCode.PARSE_ERROR,
          errors: [{ message: entry.parseError }],
          raw: entry.raw,
        });
        continue;
      }

      const validation = validateImportRecord(entity, entry.raw);
      if (!validation.success) {
        totals.failed += 1;
        bulkRecords.inc({ entity, status: 'validation_error' });
        bulkJobErrors.inc({ entity, code: ImportErrorCode.VALIDATION_ERROR });
        await createJobError({
          jobId,
          line: entry.line,
          externalId: idFromRaw(entry.raw),
          code: ImportErrorCode.VALIDATION_ERROR,
          errors: validation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          raw: entry.raw,
        });
        continue;
      }

      totals.valid += 1;
      bulkRecords.inc({ entity, status: 'valid' });

      if (entity === 'users') {
        buffers.users.push({ line: entry.line, data: validation.data as UserImportRecord });
        if (buffers.users.length >= FLUSH_SIZE) {
          await flushUsersBatch(context, buffers.users.splice(0, buffers.users.length));
        }
      } else if (entity === 'articles') {
        buffers.articles.push({ line: entry.line, data: validation.data as ArticleImportRecord });
        if (buffers.articles.length >= FLUSH_SIZE) {
          await flushArticlesBatch(context, buffers.articles.splice(0, buffers.articles.length));
        }
      } else {
        buffers.comments.push({ line: entry.line, data: validation.data as CommentImportRecord });
        if (buffers.comments.length >= FLUSH_SIZE) {
          await flushCommentsBatch(context, buffers.comments.splice(0, buffers.comments.length));
        }
      }

      if (totals.read % env.JOB_PROGRESS_EVERY === 0) {
        await updateJobTotals(jobId, totals);
        if (Date.now() - lastLogMs >= 5000) {
          logProgress(context, startMs);
          lastLogMs = Date.now();
        }
      }
    }

    await flushAllBuffers(context, buffers);

    if (entity === 'articles') {
      const conflicts = await findAndDeleteSlugConflicts(jobId);
      for (const conflict of conflicts) {
        totals.failed += 1;
        bulkRecords.inc({ entity: 'articles', status: 'slug_conflict' });
        bulkJobErrors.inc({ entity: 'articles', code: ImportErrorCode.SLUG_CONFLICT });
        await createJobError({
          jobId,
          line: conflict.line,
          externalId: conflict.external_id,
          code: ImportErrorCode.SLUG_CONFLICT,
          errors: [
            {
              path: 'slug',
              message: `slug '${conflict.slug}' conflicts with existing data`,
            },
          ],
          raw: null,
        });
      }
    }

    await mergeStagingRows(entity, jobId);
    totals.written = await countStagingRows(stagingTable, jobId);

    await updateJobTotals(jobId, totals);
    await deleteStagingRows(stagingTable, jobId);
    await markJobCompleted(jobId, { totals });
    logCompleted(context, startMs);
  } catch (error) {
    await deleteStagingRows(stagingTable, jobId).catch((cleanupErr) => {
      logger.warn({ msg: 'import_staging_cleanup_failed', jobId, err: toErrorMessage(cleanupErr, 'unknown') });
    });
    await markJobFailed(jobId, toErrorMessage(error, 'unknown import error'));
    logger.error({
      msg: 'import_job_failed',
      jobId,
      entity,
      err: toErrorMessage(error, 'unknown import error'),
    });
    throw error;
  } finally {
    timer();
    copyClient.release();
    bulkJobsRunning.dec(1);
  }
}
