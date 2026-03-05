import { prisma } from '../../infrastructure/prisma/client';

// Each merge is a single statement executed entirely inside PostgreSQL. 
// This eliminates the previous N+1 pattern (one Prisma upsert per row) and reduces merge time from O(N) round-trips to O(1).

async function mergeUsers(jobId: string) {
  await prisma.$executeRaw`
    INSERT INTO users (external_id, email, name, role, active, created_at, updated_at)
    SELECT
      payload->>'externalId',
      payload->>'email',
      payload->>'name',
      COALESCE(payload->>'role', 'user'),
      COALESCE((payload->>'active')::boolean, true),
      COALESCE((payload->>'createdAt')::timestamptz, now()),
      COALESCE((payload->>'updatedAt')::timestamptz, now())
    FROM stg_users
    WHERE job_id = ${jobId}::uuid
    ORDER BY line ASC
    ON CONFLICT (external_id) DO UPDATE SET
      email      = EXCLUDED.email,
      name       = EXCLUDED.name,
      role       = EXCLUDED.role,
      active     = EXCLUDED.active,
      updated_at = EXCLUDED.updated_at
  `;
}

async function mergeArticles(jobId: string) {
  await prisma.$executeRaw`
    INSERT INTO articles
      (external_id, slug, author_external_id, title, body, tags, status, published_at, created_at, updated_at)
    SELECT
      payload->>'externalId',
      payload->>'slug',
      payload->>'authorExternalId',
      payload->>'title',
      payload->>'body',
      COALESCE(payload->'tags', '[]'::jsonb),
      COALESCE(payload->>'status', 'draft'),
      (payload->>'publishedAt')::timestamptz,
      COALESCE((payload->>'createdAt')::timestamptz, now()),
      COALESCE((payload->>'updatedAt')::timestamptz, now())
    FROM stg_articles
    WHERE job_id = ${jobId}::uuid
    ORDER BY line ASC
    ON CONFLICT (external_id) DO UPDATE SET
      slug               = EXCLUDED.slug,
      author_external_id = EXCLUDED.author_external_id,
      title              = EXCLUDED.title,
      body               = EXCLUDED.body,
      tags               = EXCLUDED.tags,
      status             = EXCLUDED.status,
      published_at       = EXCLUDED.published_at,
      updated_at         = EXCLUDED.updated_at
  `;
}

async function mergeComments(jobId: string) {
  await prisma.$executeRaw`
    INSERT INTO comments (external_id, article_external_id, user_external_id, body, created_at)
    SELECT
      payload->>'externalId',
      payload->>'articleExternalId',
      payload->>'userExternalId',
      payload->>'body',
      COALESCE((payload->>'createdAt')::timestamptz, now())
    FROM stg_comments
    WHERE job_id = ${jobId}::uuid
    ORDER BY line ASC
    ON CONFLICT (external_id) DO UPDATE SET
      article_external_id = EXCLUDED.article_external_id,
      user_external_id    = EXCLUDED.user_external_id,
      body                = EXCLUDED.body,
      created_at          = EXCLUDED.created_at
  `;
}

export async function mergeStagingRows(
  entity: 'users' | 'articles' | 'comments',
  jobId: string,
) {
  if (entity === 'users') {
    await mergeUsers(jobId);
  } else if (entity === 'articles') {
    await mergeArticles(jobId);
  } else {
    await mergeComments(jobId);
  }
}
