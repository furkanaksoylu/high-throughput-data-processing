import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  ExportCreateResponse,
  ImportCreateResponse,
  TestWorkers,
} from "./helpers";

const describeIf = integrationEnabled ? describe : describe.skip;

describeIf("Exports API E2E", () => {
  let app: AppInstance;
  let worker: TestWorkers;
  let headers: Record<string, string>;
  let suffix: string;

  beforeAll(async () => {
    app = await buildTestApp();
    headers = await authHeader(app);
    worker = await startTestWorker();

    suffix = uniqueSuffix();

    const usersUpload = buildMultipartUpload({
      resource: "users",
      fileName: `users-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `export-user-${suffix}`,
          email: `export-user-${suffix}@example.com`,
          name: "Export User",
          role: "author",
          active: true,
        }),
      ].join("\n"),
    });

    const usersRes = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: { ...headers, ...usersUpload.headers, "idempotency-key": `export-users-${suffix}` },
      payload: usersUpload.payload,
    });

    expect(usersRes.statusCode).toBe(202);
    const usersBody = usersRes.json<ImportCreateResponse>();
    await waitForJob(app, usersBody.statusUrl, headers, 20_000);

    const articlesUpload = buildMultipartUpload({
      resource: "articles",
      fileName: `articles-${suffix}.ndjson`,
      fileContent: [
        JSON.stringify({
          id: `export-article-${suffix}`,
          slug: `export-article-${suffix}`,
          title: "Exportable Article",
          body: "Article Body",
          author_id: `export-user-${suffix}`,
          tags: ["bulk", "test"],
          status: "draft",
        }),
      ].join("\n"),
    });

    const articlesRes = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        ...headers,
        ...articlesUpload.headers,
        "idempotency-key": `export-articles-${suffix}`,
      },
      payload: articlesUpload.payload,
    });

    expect(articlesRes.statusCode).toBe(202);
    const articlesBody = articlesRes.json<ImportCreateResponse>();
    await waitForJob(app, articlesBody.statusUrl, headers, 20_000);
  });

  afterAll(async () => {
    await stopTestWorker(worker);
    if (app) {
      await app.close();
    }
  });

  it("returns 401 without authorization", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/exports?resource=users" });
    expect(res.statusCode).toBe(401);
  });

  it("streams NDJSON export with expected fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/exports?resource=articles&format=ndjson&limit=50",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("ndjson");

    const rows = parseNdjsonRows(res.body);
    expect(rows.some((row) => row.id === `export-article-${suffix}`)).toBe(true);
  });

  it("runs async export and provides downloadable file", async () => {
    const exportRes = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify({
        resource: "articles",
        format: "ndjson",
        filters: { author_id: `export-user-${suffix}` },
        fields: ["id", "slug", "status"],
      }),
    });

    expect(exportRes.statusCode).toBe(202);
    const body = exportRes.json<ExportCreateResponse>();

    const status = await waitForJob(app, body.statusUrl, headers, 20_000);
    expect(status.status).toBe("completed");
    expect(typeof status.downloadUrl).toBe("string");
    const downloadUrl = status.downloadUrl as string;
    expect(downloadUrl).toMatch(/\/v1\/exports\/.+\/download/);

    const downloadRes = await app.inject({
      method: "GET",
      url: downloadUrl,
      headers,
    });

    expect(downloadRes.statusCode).toBe(200);
    const lines = parseNdjsonRows<Record<string, unknown>>(downloadRes.body);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toHaveProperty("id");
    expect(lines[0]).toHaveProperty("slug");
    expect(lines[0]).toHaveProperty("status");
    expect(lines[0]).not.toHaveProperty("body");
  });

  it("supports async export in json format", async () => {
    const exportRes = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify({
        resource: "articles",
        format: "json",
        filters: { author_id: `export-user-${suffix}` },
        fields: ["id", "slug"],
      }),
    });

    expect(exportRes.statusCode).toBe(202);
    const body = exportRes.json<ExportCreateResponse>();
    const status = await waitForJob(app, body.statusUrl, headers, 20_000);
    expect(status.status).toBe("completed");
    expect(typeof status.downloadUrl).toBe("string");
    const downloadUrl = status.downloadUrl as string;

    const downloadRes = await app.inject({
      method: "GET",
      url: downloadUrl,
      headers,
    });

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers["content-type"]).toContain("application/json");
    const rows = JSON.parse(downloadRes.body);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("slug");
    expect(rows[0]).not.toHaveProperty("body");
  });
});
