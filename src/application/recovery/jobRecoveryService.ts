import { randomUUID } from 'node:crypto';
import { toErrorMessage } from '../../shared/utils/errorMessage';
import { redis } from '../../infrastructure/redis/client';
import { logger } from '../../infrastructure/observability/logger';
import {
  markStaleRunningJobsFailed,
  queuedExportJobIds,
  queuedImportJobIds,
} from '../../infrastructure/repositories/jobRepository';
import { enqueueBulkJob, type BulkQueueJobName } from '../../infrastructure/queue/bulkQueue';

const RECOVERY_LOCK_KEY = 'job:recovery:lock';
const RECOVERY_LOCK_TTL_MS = 60_000;

async function acquireRecoveryLock(): Promise<string | null> {
  const token = randomUUID();  
  const result = await redis.set(RECOVERY_LOCK_KEY, token, 'PX', RECOVERY_LOCK_TTL_MS, 'NX');
  return result === 'OK' ? token : null;
}

async function releaseRecoveryLock(token: string): Promise<void> {
  try {
    const current = await redis.get(RECOVERY_LOCK_KEY);
    if (current === token) {
      await redis.del(RECOVERY_LOCK_KEY);
    }
  } catch {
    // Lock will expire naturally via TTL
  }
}

async function requeueQueuedJobs(
  jobIds: string[],
  queueJobName: BulkQueueJobName,
): Promise<{ requeued: number; alreadyQueued: number; failed: number }> {
  let requeued = 0;
  let alreadyQueued = 0;
  let failed = 0;

  for (const jobId of jobIds) {
    try {
      const result = await enqueueBulkJob({ name: queueJobName, jobId });
      if (result === 'queued') {
        requeued += 1;
      } else {
        alreadyQueued += 1;
      }
    } catch (error) {
      failed += 1;
      logger.error({
        msg: 'job_requeue_failed',
        queueJobName,
        jobId,
        err: toErrorMessage(error, 'unknown queue enqueue error'),
      });
    }
  }

  return { requeued, alreadyQueued, failed };
}

export async function recoverAndRequeueJobs(): Promise<void> {
  const lockToken = await acquireRecoveryLock();
  if (!lockToken) {
    logger.debug({ msg: 'job_recovery_skipped', reason: 'another_worker_holds_lock' });
    return;
  }

  try {
    const [queuedImports, queuedExports, staleJobs] = await Promise.all([
      queuedImportJobIds(),
      queuedExportJobIds(),
      markStaleRunningJobsFailed(),
    ]);

    const [importsRecovery, exportsRecovery] = await Promise.all([
      requeueQueuedJobs(queuedImports, 'processImport'),
      requeueQueuedJobs(queuedExports, 'processExport'),
    ]);

    logger.info({
      msg: 'job_recovery_done',
      queuedImports: queuedImports.length,
      queuedExports: queuedExports.length,
      importRequeued: importsRecovery.requeued,
      importAlreadyQueued: importsRecovery.alreadyQueued,
      importRequeueFailed: importsRecovery.failed,
      exportRequeued: exportsRecovery.requeued,
      exportAlreadyQueued: exportsRecovery.alreadyQueued,
      exportRequeueFailed: exportsRecovery.failed,
      staleMarkedFailed: staleJobs,
    });
  } finally {
    await releaseRecoveryLock(lockToken);
  }
}
