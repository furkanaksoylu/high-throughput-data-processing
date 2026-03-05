import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  integrationEnabled,
  buildMultipartUpload,
  buildTestApp,
  authHeader,
  parseNdjsonRows,
  startTestWorker,
  stopTestWorker,
  uniqueSuffix,
  waitForJob,
  AppInstance,
  ImportCreateResponse,
  TestWorkers,
} from './helpers';

const describeIf = integrationEnabled ? describe : describe.skip;

describeIf('Imports API E2E', () => {
  let app: AppInstance;
  let worker: TestWorkers;
  let headers: Record<string, string>;

  beforeAll(async () => {
    app = await buildTestApp();
    headers = await authHeader(app);
    worker = await startTestWorker();
  });

  afterAll(async () => {
    await stopTestWorker(worker);
    if (app) {
      await app.close();
    }
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        resource: 'users',
        url: 'https://example.com/users.ndjson',
      }),
    });

    expect(res.statusCode).toBe(401);
  });

  it('imports users from csv multipart upload', async () => {
    const suffix = uniqueSuffix();
    const csv = [
      'id,email,name,role,active,created_at,updated_at',
      [
        `csv-user-${suffix}`,
        `csv-${suffix}@example.com`,
        'CSV User',
        'user',
        'true',
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:01:00Z',
      ].join(','),
    ].join('\n');

    const upload = buildMultipartUpload({
      resource: 'users',
      format: 'csv',
      fileName: `users-${suffix}.csv`,
      fileContent: csv,
      fileContentType: 'text/csv',
    });

    const importRes = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...upload.headers,
        'idempotency-key': `csv-${suffix}`,
      },
      payload: upload.payload,
    });

    expect(importRes.statusCode).toBe(202);
    const body = importRes.json<ImportCreateResponse>();
    const finished = await waitForJob(app, body.statusUrl, headers, 20_000);
    const totals = finished.totals as {
      read?: number;
      valid?: number;
      failed?: number;
      written?: number;
    };

    expect(finished.status).toBe('completed');
    expect(Number(totals.read ?? 0)).toBe(1);
    expect(Number(totals.valid ?? 0)).toBe(1);
    expect(Number(totals.failed ?? 0)).toBe(0);
    expect(Number(totals.written ?? 0)).toBe(1);
  });

  it('supports idempotency-key replay', async () => {
    const suffix = uniqueSuffix();
    const upload = buildMultipartUpload({
      resource: 'users',
      fileName: `users-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `idem-user-${suffix}`,
          email: `idem-${suffix}@example.com`,
          name: 'Idem User',
          role: 'user',
          active: true,
        }),
      ].join('\n'),
    });

    const idemKey = `idem-${suffix}`;

    const first = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { ...headers, ...upload.headers, 'idempotency-key': idemKey },
      payload: upload.payload,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { ...headers, ...upload.headers, 'idempotency-key': idemKey },
      payload: upload.payload,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json<ImportCreateResponse>();
    const secondBody = second.json<ImportCreateResponse>();
    expect(firstBody.jobId).toBe(secondBody.jobId);
  });

  it('rejects idempotency-key reuse with different payload', async () => {
    const suffix = uniqueSuffix();
    const idemKey = `idem-mismatch-${suffix}`;

    const firstUpload = buildMultipartUpload({
      resource: 'users',
      fileName: `users-first-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `idem-first-${suffix}`,
          email: `idem-first-${suffix}@example.com`,
          name: 'First User',
          role: 'user',
          active: true,
        }),
      ].join('\n'),
    });

    const secondUpload = buildMultipartUpload({
      resource: 'users',
      fileName: `users-second-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `idem-second-${suffix}`,
          email: `idem-second-${suffix}@example.com`,
          name: 'Second User',
          role: 'user',
          active: true,
        }),
      ].join('\n'),
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...firstUpload.headers,
        'idempotency-key': idemKey,
      },
      payload: firstUpload.payload,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...secondUpload.headers,
        'idempotency-key': idemKey,
      },
      payload: secondUpload.payload,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
  });

  it('deduplicates concurrent requests with the same idempotency key', async () => {
    const suffix = uniqueSuffix();
    const upload = buildMultipartUpload({
      resource: 'users',
      fileName: `users-concurrent-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `idem-concurrent-${suffix}`,
          email: `idem-concurrent-${suffix}@example.com`,
          name: 'Concurrent User',
          role: 'user',
          active: true,
        }),
      ].join('\n'),
    });

    const idemKey = `idem-concurrent-${suffix}`;

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/imports',
        headers: { ...headers, ...upload.headers, 'idempotency-key': idemKey },
        payload: upload.payload,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/imports',
        headers: { ...headers, ...upload.headers, 'idempotency-key': idemKey },
        payload: upload.payload,
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort(
      (a, b) => a - b,
    );
    expect(statuses).toEqual([200, 202]);
    const firstBody = first.json<ImportCreateResponse>();
    const secondBody = second.json<ImportCreateResponse>();
    expect(firstBody.jobId).toBe(secondBody.jobId);
  });

  it('captures per-record errors and continues on duplicate user natural key', async () => {
    const suffix = uniqueSuffix();
    const email = `dup-${suffix}@example.com`;

    const upload = buildMultipartUpload({
      resource: 'users',
      fileName: `users-dup-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `u-${suffix}-1`,
          email,
          name: 'First',
          role: 'user',
          active: true,
        }),
        JSON.stringify({
          id: `u-${suffix}-2`,
          email,
          name: 'Second',
          role: 'user',
          active: true,
        }),
      ].join('\n'),
    });

    const importRes = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...upload.headers,
        'idempotency-key': `dup-${suffix}`,
      },
      payload: upload.payload,
    });

    expect(importRes.statusCode).toBe(202);
    const importBody = importRes.json<ImportCreateResponse>();

    const finished = await waitForJob(
      app,
      importBody.statusUrl,
      headers,
      20_000,
    );
    const totals = finished.totals as { failed?: number };
    expect(finished.status).toBe('completed');
    expect(Number(totals.failed ?? 0)).toBeGreaterThanOrEqual(1);

    const errorsRes = await app.inject({
      method: 'GET',
      url: importBody.errorsUrl,
      headers,
    });

    expect(errorsRes.statusCode).toBe(200);
    const rows = parseNdjsonRows<{ code?: string }>(errorsRes.body);
    expect(rows.some((row) => row.code === 'DUPLICATE_NATURAL_KEY')).toBe(true);
  });

  it('records FK errors and still imports valid article records', async () => {
    const suffix = uniqueSuffix();

    const usersUpload = buildMultipartUpload({
      resource: 'users',
      fileName: `author-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `author-${suffix}`,
          email: `author-${suffix}@example.com`,
          name: 'Author',
          role: 'author',
          active: true,
        }),
      ].join('\n'),
    });

    const usersRes = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...usersUpload.headers,
        'idempotency-key': `author-${suffix}`,
      },
      payload: usersUpload.payload,
    });

    expect(usersRes.statusCode).toBe(202);
    const usersBody = usersRes.json<ImportCreateResponse>();
    await waitForJob(app, usersBody.statusUrl, headers, 20_000);

    const articleUpload = buildMultipartUpload({
      resource: 'articles',
      fileName: `articles-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `art-valid-${suffix}`,
          slug: `article-valid-${suffix}`,
          title: 'Valid',
          body: 'Valid body',
          author_id: `author-${suffix}`,
          status: 'draft',
        }),
        JSON.stringify({
          id: `art-invalid-${suffix}`,
          slug: `article-invalid-${suffix}`,
          title: 'Invalid',
          body: 'Invalid body',
          author_id: `missing-author-${suffix}`,
          status: 'draft',
        }),
      ].join('\n'),
    });

    const articleRes = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: {
        ...headers,
        ...articleUpload.headers,
        'idempotency-key': `articles-${suffix}`,
      },
      payload: articleUpload.payload,
    });

    expect(articleRes.statusCode).toBe(202);
    const body = articleRes.json<ImportCreateResponse>();
    const finished = await waitForJob(app, body.statusUrl, headers, 20_000);
    const totals = finished.totals as { failed?: number; written?: number };

    expect(finished.status).toBe('completed');
    expect(Number(totals.failed ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(totals.written ?? 0)).toBeGreaterThanOrEqual(1);

    const errorsRes = await app.inject({
      method: 'GET',
      url: body.errorsUrl,
      headers,
    });
    const rows = parseNdjsonRows<{ code?: string }>(errorsRes.body);
    expect(rows.some((row) => row.code === 'FK_ERROR')).toBe(true);
  });
});
