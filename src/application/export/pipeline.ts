import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { toErrorMessage } from '../../shared/utils/errorMessage';
import { BadRequestError } from '../../domain/errors';
import type { BulkEntity, ExportParams } from '../../domain/importExport/types';

import {
  findJobById,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
} from '../../infrastructure/repositories/jobRepository';

import { exportOutputPath } from '../../infrastructure/storage/importStorage';
import { logger } from '../../infrastructure/observability/logger';
import {
  bulkExportRows,
  bulkJobDurationSeconds,
  bulkJobsRunning,
} from '../../infrastructure/observability/metrics';

import { applyFieldProjection, contentTypeForFormat, toDto } from './exportDto';

import { fetchExportRows } from './streamingExporter';
import { env } from '../../infrastructure/config/env';

function createRowGenerator(entity: BulkEntity, params: ExportParams) {
  return async function* () {
    let afterId: string | null = null;

    while (true) {
      const rows = await fetchExportRows({
        entity,
        filters: params.filters,
        afterId,
        limit: env.EXPORT_FETCH_BATCH_SIZE,
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        afterId = row.externalId;
        yield row;
      }
    }
  };
}

function createDtoTransform(entity: BulkEntity, params: ExportParams) {
  return new Transform({
    objectMode: true,
    transform(row, _, cb) {
      try {
        const dto = toDto(entity, row);
        const projected = applyFieldProjection(entity, dto, params.fields);
        cb(null, projected);
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

function createJsonFormatTransform(format: 'json' | 'ndjson') {
  let isFirst = true;

  return new Transform({
    objectMode: true,
    transform(obj, _, cb) {
      try {
        if (format === 'ndjson') {
          cb(null, JSON.stringify(obj) + '\n');
          return;
        }

        // JSON array mode
        const prefix = isFirst ? '' : ',';
        isFirst = false;

        cb(null, prefix + JSON.stringify(obj));
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

function createJsonArrayWrapper() {
  let started = false;

  return new Transform({
    transform(chunk, _, cb) {
      if (!started) {
        started = true;
        cb(null, '[' + chunk);
        return;
      }
      cb(null, chunk);
    },
    flush(cb) {
      if (!started) {
        // empty array case
        cb(null, '[]\n');
        return;
      }
      cb(null, ']\n');
    },
  });
}

function createMetricsTransform(jobId: string, entity: string) {
  let written = 0;
  const startedAt = Date.now();
  let lastLogAt = startedAt;

  return new Transform({
    transform(chunk, _, cb) {
      written++;
      bulkExportRows.inc({ entity, type: 'async' });

      const now = Date.now();
      if (now - lastLogAt >= 5000) {
        const elapsed = (now - startedAt) / 1000;

        logger.info({
          msg: 'export_progress',
          jobId,
          entity,
          written,
          rows_per_sec: elapsed > 0 ? Math.round(written / elapsed) : 0,
        });

        lastLogAt = now;
      }

      cb(null, chunk);
    },
    flush(cb) {
      const duration = (Date.now() - startedAt) / 1000;

      logger.info({
        msg: 'export_stream_completed',
        jobId,
        entity,
        written,
        duration_sec: Math.round(duration),
        rows_per_sec: duration > 0 ? Math.round(written / duration) : 0,
      });

      cb();
    },
  });
}

export async function runExportJob(jobId: string) {
  const job = await findJobById(jobId, 'export');
  if (!job) return;

  const { entity, format } = job;

  if (format !== 'json' && format !== 'ndjson') {
    await markJobFailed(jobId, `unsupported export format: ${format}`);
    throw new BadRequestError(`unsupported export format: ${format}`);
  }

  const params = (job.params ?? {}) as ExportParams;

  bulkJobsRunning.inc(1);
  const timer = bulkJobDurationSeconds.startTimer({
    entity,
    type: 'export',
  });

  await markJobRunning(jobId);

  try {
    const outputPath = exportOutputPath({
      jobId,
      entity,
      format,
    });

    const source = Readable.from(createRowGenerator(entity, params)(), {
      objectMode: true,
    });

    const destination = createWriteStream(outputPath);

    await pipeline(
      source,
      createDtoTransform(entity, params),
      createJsonFormatTransform(format),
      createMetricsTransform(jobId, entity),
      format === 'json'
        ? createJsonArrayWrapper()
        : new Transform({
            transform(chunk, _, cb) {
              cb(null, chunk);
            },
          }),
      destination,
    );

    await markJobCompleted(jobId, {
      outputPath,
      totals: {
        read: 0,
        valid: 0,
        failed: 0,
        written: 0,
      },
    });
  } catch (error: unknown) {
    const errorMessage = toErrorMessage(error, 'unknown export error');

    await markJobFailed(jobId, errorMessage);

    logger.error({
      msg: 'export_job_failed',
      jobId,
      err: errorMessage,
    });

    throw error;
  } finally {
    timer();
    bulkJobsRunning.dec(1);
  }
}

export { contentTypeForFormat };