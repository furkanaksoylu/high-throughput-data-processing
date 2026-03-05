import { createApp } from '../../src/interfaces/http/app';
import { startWorker } from '../../src/interfaces/worker';
import { pool } from '../../src/infrastructure/database';
import { getImportQueue, getExportQueue } from '../../src/infrastructure/queue/bulkQueue';
import { redis } from '../../src/infrastructure/redis/client';
import { prisma } from '../../src/infrastructure/prisma/client';

const integrationRequested = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.RUN_INTEGRATION_TESTS ?? '1').trim().toLowerCase(),
);

export const integrationEnabled =
  integrationRequested &&
  Boolean(process.env.DB_HOST) &&
  Boolean(process.env.REDIS_HOST);

export type AppInstance = Awaited<ReturnType<typeof createApp>>;

export type TestWorkers = Awaited<ReturnType<typeof startWorker>>;
export type ImportCreateResponse = {
  jobId: string;
  statusUrl: string;
  errorsUrl: string;
};
export type ExportCreateResponse = {
  jobId: string;
  statusUrl: string;
  downloadUrl: string;
};
export type JobStatusBody = {
  status: 'queued' | 'running' | 'completed' | 'failed';
  [key: string]: unknown;
};

export async function buildTestApp(): Promise<AppInstance> {
  const app = await createApp();
  await app.ready();
  return app;
}

let cachedToken: string | null = null;

export async function authHeader(
  app: AppInstance,
): Promise<Record<'authorization', string>> {
  if (cachedToken) {
    return { authorization: `Bearer ${cachedToken}` };
  }

  const registerRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      email: `integration-admin-${uniqueSuffix()}@example.com`,
      name: 'Integration Admin',
      password: 'StrongPass123!',
      role: 'admin',
    }),
  });

  if (registerRes.statusCode >= 400) {
    throw new Error(`Unable to register integration user: ${registerRes.body}`);
  }

  const token = registerRes.json().token as string;
  cachedToken = token;
  return { authorization: `Bearer ${token}` };
}

export async function startTestWorker(): Promise<TestWorkers> {
  return startWorker();
}

export async function stopTestWorker(workers: TestWorkers | undefined) {
  if (!workers) return;
  await Promise.all([workers.importWorker.close(), workers.exportWorker.close()]);
}

export async function shutdownTestResources() {
  await Promise.all([getImportQueue().close(), getExportQueue().close()]);
  await redis.quit();
  await prisma.$disconnect();
  await pool.end();
}

export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function parseNdjsonRows<T = Record<string, unknown>>(body: string): T[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function makeUserNdjson(count: number): string {
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      id: `test-user-${i}`,
      email: `user${i}@example.com`,
      name: `User ${i}`,
      role: 'user',
      active: true,
    }),
  ).join('\n');
}

export function makeArticleNdjson(
  count: number,
  authorId = 'test-user-0',
): string {
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      id: `test-art-${i}`,
      slug: `test-article-${i}`,
      author_id: authorId,
      title: `Article ${i}`,
      body: `Body of article ${i}`,
      tags: ['test'],
      status: 'draft',
    }),
  ).join('\n');
}

export function makeCommentNdjson(
  count: number,
  articleId = 'test-art-0',
  userId = 'test-user-0',
): string {
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      id: `test-comment-${i}`,
      article_id: articleId,
      user_id: userId,
      body: `Comment body ${i}`,
    }),
  ).join('\n');
}

export function buildMultipartUpload(input: {
  resource: 'users' | 'articles' | 'comments';
  format?: 'ndjson' | 'json' | 'csv';
  fileName: string;
  fileContent: string;
  fileContentType?: string;
}) {
  const boundary = `----codex-boundary-${uniqueSuffix()}`;
  const lines: string[] = [];

  lines.push(`--${boundary}`);
  lines.push(`Content-Disposition: form-data; name="resource"`);
  lines.push('');
  lines.push(input.resource);

  lines.push(`--${boundary}`);
  lines.push(`Content-Disposition: form-data; name="format"`);
  lines.push('');
  lines.push(input.format ?? 'ndjson');

  lines.push(`--${boundary}`);
  lines.push(
    `Content-Disposition: form-data; name="file"; filename="${input.fileName}"`,
  );
  lines.push('Content-Type: ' + (input.fileContentType ?? 'application/x-ndjson'));
  lines.push('');
  lines.push(input.fileContent);
  lines.push(`--${boundary}--`);
  lines.push('');

  return {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(lines.join('\r\n'), 'utf8'),
  };
}

export async function waitForJob(
  app: AppInstance,
  statusUrl: string,
  headers: Record<string, string>,
  maxWaitMs = 15_000,
): Promise<JobStatusBody> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: statusUrl, headers });
    if (res.statusCode >= 400) {
      throw new Error(`Polling ${statusUrl} failed with ${res.statusCode}: ${res.body}`);
    }

    const body = res.json<JobStatusBody>();
    if (body.status === 'completed' || body.status === 'failed') return body;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Job did not finish within ${maxWaitMs}ms`);
}
