-- CreateTable
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'author',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_path" TEXT,
    "output_path" TEXT,
    "params" JSONB,
    "gzip" BOOLEAN NOT NULL DEFAULT false,
    "totals" JSONB NOT NULL DEFAULT '{"read":0,"valid":0,"failed":0,"written":0}',
    "last_error" TEXT,
    "created_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bulk_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_idempotency" (
    "key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "entity" TEXT,
    "format" TEXT,
    "request_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_idempotency_pkey" PRIMARY KEY ("key","created_by")
);

-- CreateTable
CREATE TABLE "bulk_job_errors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "line" INTEGER,
    "external_id" TEXT,
    "code" TEXT NOT NULL,
    "errors" JSONB,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_job_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" BIGSERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "slug" TEXT,
    "author_external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" BIGSERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "article_external_id" TEXT NOT NULL,
    "user_external_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stg_users" (
    "job_id" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stg_users_pkey" PRIMARY KEY ("job_id","line")
);

-- CreateTable
CREATE TABLE "stg_articles" (
    "job_id" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stg_articles_pkey" PRIMARY KEY ("job_id","line")
);

-- CreateTable
CREATE TABLE "stg_comments" (
    "job_id" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stg_comments_pkey" PRIMARY KEY ("job_id","line")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE INDEX "idx_bulk_jobs_created_by" ON "bulk_jobs"("created_by");

-- CreateIndex
CREATE INDEX "idx_bulk_jobs_type_status" ON "bulk_jobs"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "idx_import_idempotency_key_user" ON "import_idempotency"("key", "created_by");

-- CreateIndex
CREATE INDEX "idx_bulk_job_errors_job_id_created" ON "bulk_job_errors"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "articles_external_id_key" ON "articles"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE INDEX "idx_articles_author_external_id" ON "articles"("author_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "comments_external_id_key" ON "comments"("external_id");

-- CreateIndex
CREATE INDEX "idx_comments_article_external_id" ON "comments"("article_external_id");

-- CreateIndex
CREATE INDEX "idx_comments_user_external_id" ON "comments"("user_external_id");

-- CreateIndex
CREATE INDEX "idx_stg_users_job_id" ON "stg_users"("job_id");

-- CreateIndex
CREATE INDEX "idx_stg_users_job_external_id" ON "stg_users"("job_id", "external_id");

-- CreateIndex
CREATE INDEX "idx_stg_articles_job_id" ON "stg_articles"("job_id");

-- CreateIndex
CREATE INDEX "idx_stg_articles_job_external_id" ON "stg_articles"("job_id", "external_id");

-- CreateIndex
CREATE INDEX "idx_stg_comments_job_id" ON "stg_comments"("job_id");

-- CreateIndex
CREATE INDEX "idx_stg_comments_job_external_id" ON "stg_comments"("job_id", "external_id");

-- AddForeignKey
ALTER TABLE "bulk_job_errors" ADD CONSTRAINT "bulk_job_errors_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "bulk_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_external_id_fkey" FOREIGN KEY ("author_external_id") REFERENCES "users"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_external_id_fkey" FOREIGN KEY ("article_external_id") REFERENCES "articles"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_external_id_fkey" FOREIGN KEY ("user_external_id") REFERENCES "users"("external_id") ON DELETE RESTRICT ON UPDATE CASCADE;
