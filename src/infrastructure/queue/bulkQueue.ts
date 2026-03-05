import { Queue } from 'bullmq';
import { env } from '../config/env';
import { toErrorMessage } from '../../shared/utils/errorMessage';

export type BulkQueueJobName = 'processImport' | 'processExport';

export const IMPORT_QUEUE_NAME = `${env.BULK_QUEUE_NAME}-import`;
export const EXPORT_QUEUE_NAME = `${env.BULK_QUEUE_NAME}-export`;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const;

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT };

let importQueue: Queue | null = null;
let exportQueue: Queue | null = null;

export function getImportQueue(): Queue {
  if (!importQueue) {
    importQueue = new Queue(IMPORT_QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }
  return importQueue;
}

export function getExportQueue(): Queue {
  if (!exportQueue) {
    exportQueue = new Queue(EXPORT_QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }
  return exportQueue;
}

function isDuplicateJobError(error: unknown): boolean {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('already exists') || message.includes('jobid');
}

export async function enqueueBulkJob(input: {
  name: BulkQueueJobName;
  jobId: string;
}): Promise<'queued' | 'already_queued'> {
  const queue =
    input.name === 'processImport' ? getImportQueue() : getExportQueue();
  const existing = await queue.getJob(input.jobId);
  if (existing) return 'already_queued';

  try {
    await queue.add(input.name, { jobId: input.jobId }, { jobId: input.jobId });
    return 'queued';
  } catch (error) {
    if (isDuplicateJobError(error)) return 'already_queued';
    throw error;
  }
}
