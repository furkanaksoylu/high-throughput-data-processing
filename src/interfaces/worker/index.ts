import http from 'node:http';
import { Worker } from 'bullmq';
import { toErrorMessage } from '../../shared/utils/errorMessage';
import { env } from '../../infrastructure/config/env';
import { initDb } from '../../infrastructure/database';
import { logger } from '../../infrastructure/observability/logger';
import {
  EXPORT_QUEUE_NAME,
  IMPORT_QUEUE_NAME,
} from '../../infrastructure/queue/bulkQueue';
import { register as metricsRegistry } from '../../infrastructure/observability/metrics';
import { processImportJob } from '../../application/import/processor';
import { runExportJob } from '../../application/export/pipeline';
import { recoverAndRequeueJobs } from '../../application/recovery/jobRecoveryService';

const workerConnection = { host: env.REDIS_HOST, port: env.REDIS_PORT };

export async function startWorker() {
  await initDb();

  let recoveryRunning = false;
  const runRecovery = async (source: 'startup' | 'interval') => {
    if (recoveryRunning) return;
    recoveryRunning = true;
    try {
      await recoverAndRequeueJobs();
    } catch (error) {
      logger.error({
        msg: 'job_recovery_failed',
        source,
        err: toErrorMessage(error, 'unknown recovery error'),
      });
    } finally {
      recoveryRunning = false;
    }
  };

  await runRecovery('startup');

  const importWorker = new Worker(
    IMPORT_QUEUE_NAME,
    async (job) => {
      if (job.name === 'processImport') {
        await processImportJob(job.data.jobId);
        return;
      }
      throw new Error(`Unknown import job type: ${job.name}`);
    },
    { connection: workerConnection, concurrency: env.BULK_WORKER_CONCURRENCY },
  );

  const exportWorker = new Worker(
    EXPORT_QUEUE_NAME,
    async (job) => {
      if (job.name === 'processExport') {
        await runExportJob(job.data.jobId);
        return;
      }
      throw new Error(`Unknown export job type: ${job.name}`);
    },
    { connection: workerConnection, concurrency: env.BULK_WORKER_CONCURRENCY },
  );

  for (const worker of [importWorker, exportWorker]) {
    worker.on('error', (error) =>
      logger.error({
        msg: 'worker_error',
        err: toErrorMessage(error, 'unknown worker error'),
      }),
    );
    worker.on('failed', (job, error) =>
      logger.error({
        msg: 'job_failed',
        jobId: job?.id,
        jobName: job?.name,
        err: toErrorMessage(error, 'unknown job error'),
      }),
    );
  }

  const recoveryTimer = setInterval(() => {
    void runRecovery('interval');
  }, env.JOB_RECOVERY_EVERY_MS);
  recoveryTimer.unref();

  let closedWorkers = 0;
  const onClose = () => {
    closedWorkers += 1;
    if (closedWorkers >= 2) clearInterval(recoveryTimer);
  };
  importWorker.once('closed', onClose);
  exportWorker.once('closed', onClose);

  await Promise.all([
    importWorker.waitUntilReady(),
    exportWorker.waitUntilReady(),
  ]);

  if (env.METRICS_ENABLED) {
    const metricsServer = http.createServer(async (_req, res) => {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    });
    metricsServer.listen(env.WORKER_METRICS_PORT, () => {
      logger.info({ msg: 'worker_metrics_listening', port: env.WORKER_METRICS_PORT });
    });
  }

  logger.info({
    msg: 'worker_started',
    importQueue: IMPORT_QUEUE_NAME,
    exportQueue: EXPORT_QUEUE_NAME,
    concurrency: env.BULK_WORKER_CONCURRENCY,
    recoveryEveryMs: env.JOB_RECOVERY_EVERY_MS,
  });

  return { importWorker, exportWorker };
}

if (require.main === module) {
  startWorker().catch((error) => {
    logger.error({
      msg: 'worker_fatal',
      err: toErrorMessage(error, 'unknown worker fatal error'),
    });
    process.exit(1);
  });
}
