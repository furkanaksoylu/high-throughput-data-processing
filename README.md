# Bulk Data Import/Export API

A high-performance Node.js/TypeScript backend for bulk importing and exporting articles, comments, and users. Built with streaming I/O, background job processing, and per-record validation.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Dependencies](#dependencies)
- [Environment Configuration](#environment-configuration)
- [Setup Instructions](#setup-instructions)
- [Running the Application](#running-the-application)
- [Running Tests](#running-tests)
- [API Documentation](#api-documentation)
- [Data Schemas](#data-schemas)
- [Validation Rules](#validation-rules)
- [Observability](#observability)

---

## Architecture Overview

```
src/
├── domain/              # Core types, errors, validation rules
├── application/         # Use cases: import pipeline, export pipeline, auth
├── infrastructure/      # DB (Prisma + raw pg), Redis, queue, storage, metrics
├── interfaces/
│   ├── http/            # Fastify route handlers
│   └── worker/          # BullMQ worker entry point
└── main/                # API server entry point
```

**Key design decisions:**

- **Import jobs** are enqueued to a BullMQ Redis queue and processed by a separate worker process. Records are validated and bulk-inserted in configurable batches (default 1 000).
- **Streaming exports** (`GET /v1/exports`) write NDJSON directly to the HTTP response with `O(1)` memory via cursor-based pagination.
- **Async exports** (`POST /v1/exports`) are similarly queued; the finished file is written to disk and available for download.
- A **staging table** pattern (`stg_users`, `stg_articles`, `stg_comments`) is used during import to detect duplicates and resolve foreign keys before merging into production tables.
- **Idempotency** is enforced on `POST /v1/imports` via the `Idempotency-Key` header.

---

## Dependencies

### Runtime

| Package                                              | Purpose                                |
| ---------------------------------------------------- | -------------------------------------- |
| `fastify`                                            | HTTP server                            |
| `@fastify/jwt`                                       | JWT authentication                     |
| `@fastify/multipart`                                 | File upload handling                   |
| `@fastify/rate-limit`                                | Auth endpoint rate limiting            |
| `@fastify/swagger` + `@scalar/fastify-api-reference` | Interactive API docs                   |
| `@prisma/client` + `@prisma/adapter-pg`              | ORM / query builder                    |
| `pg` + `pg-copy-streams`                             | Raw PostgreSQL + COPY for bulk inserts |
| `bullmq`                                             | Background job queue                   |
| `ioredis`                                            | Redis client                           |
| `prom-client`                                        | Prometheus metrics                     |
| `split2` + `stream-json` + `stream-chain`            | Streaming NDJSON/JSON parsing          |
| `zod`                                                | Schema validation                      |
| `bcryptjs`                                           | Password hashing                       |
| `pino`                                               | Structured logging                     |
| `dotenv`                                             | Environment variable loading           |

### Dev / Test

| Package               | Purpose                           |
| --------------------- | --------------------------------- |
| `vitest`              | Test runner                       |
| `supertest`           | HTTP integration testing          |
| `tsx`                 | TypeScript execution for dev mode |
| `typescript`          | Type checking & compilation       |
| `@vitest/coverage-v8` | Coverage reports                  |

---

## Environment Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

| Variable                                                  | Default                                  | Description                                          |
| --------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `NODE_ENV`                                                | `development`                            | Node environment                                     |
| `PORT`                                                    | `3000`                                   | API server port                                      |
| `WORKER_METRICS_PORT`                                     | `9091`                                   | Worker Prometheus port                               |
| `DATABASE_URL`                                            | `postgresql://app:app@postgres:5432/app` | Full Postgres connection string                      |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME` | see file                                 | Postgres connection parts                            |
| `DB_POOL_MAX`                                             | `10`                                     | Postgres connection pool size                        |
| `REDIS_HOST`                                              | `redis`                                  | Redis hostname                                       |
| `REDIS_PORT`                                              | `6379`                                   | Redis port                                           |
| `STORAGE_DIR`                                             | `/data`                                  | Directory for import/export files                    |
| `BULK_QUEUE_NAME`                                         | `bulk`                                   | BullMQ queue name                                    |
| `BULK_WORKER_CONCURRENCY`                                 | `2`                                      | Parallel worker jobs                                 |
| `JOB_RECOVERY_EVERY_MS`                                   | `30000`                                  | Stale-job recovery interval                          |
| `STALE_JOB_TIMEOUT_MS`                                    | `1800000`                                | Job timeout before recovery                          |
| `JOB_PROGRESS_EVERY`                                      | `5000`                                   | Rows between progress updates                        |
| `IMPORT_FLUSH_SIZE`                                       | `1000`                                   | Batch size for DB writes                             |
| `IMPORT_MAX_FILE_BYTES`                                   | `1073741824`                             | Max upload size (1 GB)                               |
| `IMPORT_FETCH_TIMEOUT_MS`                                 | `30000`                                  | Timeout for URL-based imports                        |
| `EXPORT_FETCH_BATCH_SIZE`                                 | `1000`                                   | Cursor page size for exports                         |
| `METRICS_ENABLED`                                         | `true`                                   | Enable Prometheus `/metrics` endpoint                |
| `DOCS_ENABLED`                                            | `true`                                   | Enable Scalar API docs at `/docs`                    |
| `AUTH_RATE_LIMIT_MAX`                                     | `20`                                     | Max auth requests per minute                         |
| `SUPER_ADMIN_EMAIL`                                       | `superadmin@example.com`                 | Seed super-admin email                               |
| `SUPER_ADMIN_NAME`                                        | `Super Admin`                            | Seed super-admin name                                |
| `SUPER_ADMIN_PASSWORD`                                    | `ChangeMeSuperAdmin123!`                 | Seed super-admin password — **change in production** |
| `JWT_SECRET`                                              | `change-me-in-production-please`         | JWT signing secret — **change in production**        |
| `JWT_EXPIRES_IN`                                          | `12h`                                    | JWT expiry                                           |
| `SALT_ROUNDS`                                             | `12`                                     | bcrypt cost factor                                   |
| `GRAFANA_ADMIN_PASSWORD`                                  | `admin`                                  | Grafana admin password                               |

---

## Setup Instructions

### Prerequisites

- **Docker** >= 24 and **Docker Compose** v2
- **Node.js** >= 20 and **pnpm** >= 9 (for local development without Docker)

### Quick Start with Docker (Recommended)

```bash
# 1. Clone the repository
git clone <repo-url>
cd <repo-dir>

# 2. Create your .env file
cp .env.example .env

# 3. Start all services (Postgres, Redis, migrations, API, worker, Prometheus, Grafana)
docker compose up --build
```

The API will be available at `http://localhost:3000`.

| Service                       | URL                                                               |
| ----------------------------- | ----------------------------------------------------------------- |
| API                           | http://localhost:3000                                             |
| Interactive API docs (Scalar) | http://localhost:3000/docs                                        |
| Prometheus                    | http://localhost:9090                                             |
| Grafana                       | http://localhost:3001 (admin / value of `GRAFANA_ADMIN_PASSWORD`) |
| Worker metrics                | http://localhost:9091/metrics                                     |

### Local Development (without Docker)

Requires a running Postgres and Redis instance.

```bash
# 1. Install dependencies
pnpm install

# 2. Set up .env with local connection details
cp .env.example .env
# Edit DB_HOST, REDIS_HOST, etc. to point to your local services

# 3. Run database migrations
pnpm prisma:generate
DATABASE_URL=<your-url> npx prisma migrate deploy

# 4. Start the API in watch mode
pnpm dev

# 5. In a separate terminal, start the worker
pnpm worker
```

---

## Running the Application

### Production Build

```bash
pnpm build          # Compile TypeScript to dist/
pnpm start          # Start API server from dist/
pnpm worker         # Start background worker from dist/
```

### Docker — Run Tests in CI Mode

```bash
# Run integration tests inside Docker (spins up isolated Postgres + Redis)
docker compose --profile test up --build --exit-code-from test-runner
```

---

## Running Tests

### Unit Tests

```bash
pnpm test:unit
```

Runs validation and utility tests with no external dependencies.

### Integration Tests

Requires a running Postgres and Redis (use Docker or set env vars manually).

```bash
# With Docker
docker compose --profile test up --build --exit-code-from test-runner

# Locally (with services running)
RUN_INTEGRATION_TESTS=1 pnpm test:integration
```

### All Tests

```bash
pnpm test
```

### Coverage

```bash
pnpm test:coverage
```

---

## API Documentation

An interactive Scalar UI is available at `http://localhost:3000/docs` when `DOCS_ENABLED=true`.

All protected endpoints require a Bearer JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Authentication

#### `POST /v1/auth/register`

Register a new user. The first registered user is automatically promoted to `admin`.

**Request body:**

```json
{
  "email": "user@example.com",
  "name": "Alice",
  "password": "SecurePass123!",
  "role": "author"
}
```

`role` is optional. Allowed values: `admin`, `author`, `moderator`, `user`.

**Response `201`:**

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "name": "...",
    "role": "author",
    "active": true
  },
  "token": "<jwt>"
}
```

---

#### `POST /v1/auth/login`

Obtain a JWT token.

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response `200`:**

```json
{
  "user": { ... },
  "token": "<jwt>"
}
```

---

### Import

> Allowed roles: `admin`, `author`

#### `POST /v1/imports`

Start an import job. Accepts either a **multipart file upload** or a **JSON body with a remote URL**.

**Headers:**

| Header            | Required | Description                                   |
| ----------------- | -------- | --------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <jwt>`                                |
| `Idempotency-Key` | No       | Reuse an existing job for the same key + user |

**Option A — Multipart upload:**

```
Content-Type: multipart/form-data

Fields:
  resource  (required): "users" | "articles" | "comments"
  format    (required): "csv" | "ndjson" | "json"
  file      (required): the file to import
```

**Option B — URL import (JSON body):**

```json
{
  "resource": "articles",
  "format": "ndjson",
  "url": "https://example.com/data/articles.ndjson"
}
```

Supported formats: `csv`, `ndjson`, `json` (all three apply to `users`, `articles`, and `comments`)

**Response `202` (new job) / `200` (idempotent):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "statusUrl": "/v1/imports/550e8400-e29b-41d4-a716-446655440000",
  "errorsUrl": "/v1/imports/550e8400-e29b-41d4-a716-446655440000/errors"
}
```

---

#### `GET /v1/imports/:jobId`

Poll the status of an import job.

**Response `200`:**

```json
{
  "jobId": "...",
  "status": "completed",
  "entity": "users",
  "format": "csv",
  "totals": {
    "read": 10000,
    "valid": 9985,
    "failed": 15,
    "written": 9985
  },
  "startedAt": "2026-02-20T10:00:00Z",
  "finishedAt": "2026-02-20T10:00:42Z",
  "errorsUrl": "/v1/imports/.../errors"
}
```

`status` values: `pending` | `processing` | `completed` | `failed`

---

#### `GET /v1/imports/:jobId/errors`

Stream per-record validation errors as NDJSON. Returns a downloadable `.ndjson` file.

**Response** (`Content-Type: application/x-ndjson`): one JSON object per line:

```ndjson
{"job_id":"550e8400-...","line":3,"external_id":"u-001","code":"VALIDATION_ERROR","errors":[{"path":"email","message":"Invalid email"}],"raw":{"id":"u-001","email":"bad-email","name":"Alice"},"created_at":"2026-02-20T10:00:01.000Z"}
{"job_id":"550e8400-...","line":7,"external_id":null,"code":"PARSE_ERROR","errors":[{"message":"Invalid NDJSON line"}],"raw":"{broken json","created_at":"2026-02-20T10:00:02.000Z"}
```

Available `code` values: `PARSE_ERROR` | `VALIDATION_ERROR` | `DUPLICATE_NATURAL_KEY` | `DUPLICATE_ID` | `ID_NATURAL_KEY_MISMATCH` | `FK_ERROR` | `SLUG_CONFLICT`

---

### Export

> Allowed roles: `admin`, `author`, `moderator`, `user`

#### `GET /v1/exports` — Streaming Export

Stream data directly as NDJSON. Supports cursor-based pagination via trailers.

**Query parameters:**

| Parameter  | Required | Default  | Description                              |
| ---------- | -------- | -------- | ---------------------------------------- |
| `resource` | Yes      | —        | `users` \| `articles` \| `comments`      |
| `format`   | No       | `ndjson` | Only `ndjson` supported for streaming    |
| `limit`    | No       | `5000`   | Rows per response (max 50 000)           |
| `cursor`   | No       | —        | Pagination cursor from previous response |

**Response** (`Content-Type: application/x-ndjson`):

Data is streamed line-by-line. HTTP trailers are sent at the end:

```
X-Written-Count: 5000
X-Next-Cursor: eyJpZCI6MTIzNH0=
```

Use `X-Next-Cursor` in the next request to paginate.

---

#### `POST /v1/exports` — Async Export

Enqueue a background export job with optional filters and field selection.

**Request body:**

```json
{
  "resource": "articles",
  "format": "ndjson",
  "filters": {
    "status": "published"
  },
  "fields": ["id", "slug", "title", "published_at"]
}
```

**Response `202`:**

```json
{
  "jobId": "...",
  "statusUrl": "/v1/exports/...",
  "downloadUrl": "/v1/exports/.../download"
}
```

---

#### `GET /v1/exports/:jobId`

Poll the status of an async export job.

**Response `200`:**

```json
{
  "jobId": "...",
  "status": "completed",
  "entity": "articles",
  "format": "ndjson",
  "totals": { "written": 42000 },
  "hasDownload": true,
  "downloadUrl": "/v1/exports/.../download"
}
```

---

#### `GET /v1/exports/:jobId/download`

Download the completed export file.

**Response**: file stream with appropriate `Content-Disposition` and `Content-Type` headers.

---

## Data Schemas

### Users

| Field        | Type              | Notes                                        |
| ------------ | ----------------- | -------------------------------------------- |
| `id`         | string (UUID)     | External identifier                          |
| `email`      | string            | Unique, valid email                          |
| `name`       | string            |                                              |
| `role`       | string            | `admin` \| `author` \| `moderator` \| `user` |
| `active`     | boolean           |                                              |
| `created_at` | ISO 8601 datetime |                                              |
| `updated_at` | ISO 8601 datetime |                                              |

### Articles

| Field          | Type                      | Notes                            |
| -------------- | ------------------------- | -------------------------------- |
| `id`           | string (UUID)             | External identifier              |
| `slug`         | string                    | Unique, kebab-case               |
| `title`        | string                    |                                  |
| `body`         | string                    |                                  |
| `author_id`    | string                    | Must match an existing user `id` |
| `tags`         | string[]                  |                                  |
| `published_at` | ISO 8601 datetime \| null | Must be null for `draft` status  |
| `status`       | string                    | `draft` \| `published`           |

### Comments

| Field        | Type              | Notes                               |
| ------------ | ----------------- | ----------------------------------- |
| `id`         | string (UUID)     | External identifier                 |
| `article_id` | string            | Must match an existing article `id` |
| `user_id`    | string            | Must match an existing user `id`    |
| `body`       | string            | Max 500 words                       |
| `created_at` | ISO 8601 datetime |                                     |

---

## Validation Rules

- **Users**: email must be valid and unique; role must be one of the allowed values; `active` must be boolean.
- **Articles**: `author_id` must reference a valid user; `slug` must be unique and kebab-case; `draft` articles must not have `published_at`.
- **Comments**: `article_id` and `user_id` must reference existing records; `body` must be ≤ 500 words.
- **Upsert**: records with a matching `id` (or natural key: `email` for users, `slug` for articles) are updated; others are inserted.
- **Continue-on-error**: invalid records are logged to `bulk_job_errors` and skipped; valid records are still written.

---

## Observability

### Structured Logs

All logs are emitted in JSON (pino) and include `level`, `time`, `jobId`, `entity`, `rows_per_sec`, `error_rate`, and `duration_ms` fields where applicable.

### Prometheus Metrics

Available at `http://localhost:3000/metrics` (API) and `http://localhost:9091/metrics` (worker).

Custom metrics:

| Metric                          | Type      | Labels                           | Description                                                                                                  |
| ------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bulk_records_total`            | Counter   | `entity`, `status`               | Import records processed by entity and outcome (`valid`, `validation_error`, `parse_error`, `slug_conflict`) |
| `bulk_jobs_running`             | Gauge     | —                                | Number of currently running bulk jobs                                                                        |
| `bulk_job_duration_seconds`     | Histogram | `entity`, `type`                 | End-to-end job duration in seconds (`type`: `import` \| `async`)                                             |
| `bulk_export_rows_total`        | Counter   | `entity`, `type`                 | Rows written by export operations (`type`: `streaming` \| `async`)                                           |
| `bulk_job_errors_total`         | Counter   | `entity`, `code`                 | Per-record import errors by entity and error code                                                            |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency in seconds                                                                              |

Node.js default metrics (event loop, memory, GC, etc.) are also collected via `collectDefaultMetrics`.

### Grafana

Pre-configured to scrape Prometheus. Access at `http://localhost:3001` (default credentials: `admin` / value of `GRAFANA_ADMIN_PASSWORD`).
