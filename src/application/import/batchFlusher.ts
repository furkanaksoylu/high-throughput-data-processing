import type { BulkEntity } from '../../domain/importExport/types';
import { ImportErrorCode } from '../../domain/importExport/errorCodes';
import { createJobError } from '../../infrastructure/repositories/jobRepository';
import { openCopyStream } from '../../infrastructure/database/copyStream';
import {
  findStagedExternalIdPointers,
  findStagedUsersByEmail,
  type StagedPointer,
} from '../../infrastructure/repositories/stagingRepository';
import {
  findExistingExternalIds,
  findArticleExternalIdsBySlug,
  findUserExternalIdsByEmail,
} from '../../infrastructure/repositories/entityRepository';
import { bulkRecords } from '../../infrastructure/observability/metrics';
import type {
  ArticleBufferItem,
  CommentBufferItem,
  ImportProcessContext,
  StagingWriteRow,
  UserBufferItem,
} from './importTypes';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function idFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

async function recordDuplicateError(
  context: ImportProcessContext,
  input: {
    line: number;
    raw: unknown;
    code: string;
    path: string;
    message: string;
    externalId?: string;
  },
) {
  context.totals.valid -= 1;
  context.totals.failed += 1;
  bulkRecords.inc({ entity: context.entity, status: 'duplicate_key_error' });
  await createJobError({
    jobId: context.jobId,
    line: input.line,
    externalId: input.externalId ?? idFromRaw(input.raw),
    code: input.code,
    errors: [{ path: input.path, message: input.message }],
    raw: input.raw,
  });
}

async function writeRowsToStaging(
  context: ImportProcessContext,
  entity: BulkEntity,
  rows: StagingWriteRow[],
) {
  if (rows.length === 0) return;

  const copy = await openCopyStream(context.copyClient, entity);
  try {
    for (const row of rows) {
      const ok = copy.writeRow(context.jobId, row.line, row.externalId, row.payload);
      if (!ok) await copy.drain();
    }
    await copy.finish();
  } catch (error) {
    const streamError = error instanceof Error ? error : new Error(String(error));
    copy.stream.destroy(streamError);
    throw streamError;
  }
}

export async function flushUsersBatch(context: ImportProcessContext, batch: UserBufferItem[]) {
  if (batch.length === 0) return;

  const emails = uniqueStrings(batch.map((item) => item.data.email));
  const [existingByEmail, stagedByEmail] = await Promise.all([
    findUserExternalIdsByEmail(emails),
    findStagedUsersByEmail(context.jobId, emails),
  ]);

  const resolvedIds = uniqueStrings(
    batch.map((item) => existingByEmail.get(item.data.email) ?? item.data.id ?? item.data.email),
  );
  const stagedByExternalId = await findStagedExternalIdPointers(
    'stg_users',
    context.jobId,
    resolvedIds,
  );

  const batchByEmail = new Map<string, StagedPointer>();
  const batchByExternalId = new Map<string, StagedPointer>();
  const rowsToWrite: StagingWriteRow[] = [];

  for (const item of batch) {
    const email = item.data.email;
    const existingByNaturalKey = existingByEmail.get(email);

    if (batchByEmail.has(email)) {
      const first = batchByEmail.get(email)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_NATURAL_KEY,
        path: 'email',
        message: `Duplicate email in import. First seen at line ${first.line}`,
        externalId: first.externalId,
      });
      continue;
    }

    if (stagedByEmail.has(email)) {
      const first = stagedByEmail.get(email)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_NATURAL_KEY,
        path: 'email',
        message: `Duplicate email in import. First seen at line ${first.line}`,
        externalId: first.externalId,
      });
      continue;
    }

    if (existingByNaturalKey && item.data.id && existingByNaturalKey !== item.data.id) {
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.ID_NATURAL_KEY_MISMATCH,
        path: 'id',
        message: 'Provided id does not match existing record for this email',
      });
      continue;
    }

    const resolvedId = existingByNaturalKey ?? item.data.id ?? email;

    if (batchByExternalId.has(resolvedId)) {
      const first = batchByExternalId.get(resolvedId)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: resolvedId,
      });
      continue;
    }

    if (stagedByExternalId.has(resolvedId)) {
      const first = stagedByExternalId.get(resolvedId)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: resolvedId,
      });
      continue;
    }

    batchByEmail.set(email, { line: item.line, externalId: resolvedId });
    batchByExternalId.set(resolvedId, { line: item.line, externalId: resolvedId });

    rowsToWrite.push({
      line: item.line,
      externalId: resolvedId,
      payload: {
        externalId: resolvedId,
        email,
        name: item.data.name,
        role: item.data.role,
        active: item.data.active,
        createdAt: item.data.created_at ?? null,
        updatedAt: item.data.updated_at ?? null,
      },
    });
  }

  await writeRowsToStaging(context, 'users', rowsToWrite);
}

export async function flushArticlesBatch(
  context: ImportProcessContext,
  batch: ArticleBufferItem[],
) {
  if (batch.length === 0) return;

  const authorIds = uniqueStrings(batch.map((item) => item.data.author_id));
  const articleSlugs = uniqueStrings(batch.map((item) => item.data.slug));

  const [existingAuthors, existingBySlug] = await Promise.all([
    findExistingExternalIds('users', authorIds),
    findArticleExternalIdsBySlug(articleSlugs),
  ]);

  const resolvedIds = uniqueStrings(
    batch.map((item) => existingBySlug.get(item.data.slug) ?? item.data.id ?? item.data.slug),
  );
  const stagedByExternalId = await findStagedExternalIdPointers(
    'stg_articles',
    context.jobId,
    resolvedIds,
  );

  const batchByExternalId = new Map<string, StagedPointer>();
  const rowsToWrite: StagingWriteRow[] = [];

  for (const item of batch) {
    if (!existingAuthors.has(item.data.author_id)) {
      context.totals.valid -= 1;
      context.totals.failed += 1;
      bulkRecords.inc({ entity: 'articles', status: 'fk_error' });
      await createJobError({
        jobId: context.jobId,
        line: item.line,
        externalId: item.data.id ?? item.data.slug,
        code: ImportErrorCode.FK_ERROR,
        errors: [{ path: 'author_id', message: 'Referenced author was not found' }],
        raw: item.data,
      });
      continue;
    }

    const resolvedId = existingBySlug.get(item.data.slug) ?? item.data.id ?? item.data.slug;

    if (batchByExternalId.has(resolvedId)) {
      const first = batchByExternalId.get(resolvedId)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: resolvedId,
      });
      continue;
    }

    if (stagedByExternalId.has(resolvedId)) {
      const first = stagedByExternalId.get(resolvedId)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: resolvedId,
      });
      continue;
    }

    batchByExternalId.set(resolvedId, { line: item.line, externalId: resolvedId });

    rowsToWrite.push({
      line: item.line,
      externalId: resolvedId,
      payload: {
        externalId: resolvedId,
        slug: item.data.slug,
        title: item.data.title,
        body: item.data.body,
        authorExternalId: item.data.author_id,
        tags: item.data.tags,
        status: item.data.status,
        publishedAt: item.data.published_at ?? null,
        createdAt: item.data.created_at ?? null,
        updatedAt: item.data.updated_at ?? null,
      },
    });
  }

  await writeRowsToStaging(context, 'articles', rowsToWrite);
}

export async function flushCommentsBatch(
  context: ImportProcessContext,
  batch: CommentBufferItem[],
) {
  if (batch.length === 0) return;

  const userIds = uniqueStrings(batch.map((item) => item.data.user_id));
  const articleIds = uniqueStrings(batch.map((item) => item.data.article_id));
  const commentIds = uniqueStrings(batch.map((item) => item.data.id));

  const [existingUsers, existingArticles] = await Promise.all([
    findExistingExternalIds('users', userIds),
    findExistingExternalIds('articles', articleIds),
  ]);

  const stagedByExternalId = await findStagedExternalIdPointers(
    'stg_comments',
    context.jobId,
    commentIds,
  );

  const batchByExternalId = new Map<string, StagedPointer>();
  const rowsToWrite: StagingWriteRow[] = [];

  for (const item of batch) {
    const hasUser = existingUsers.has(item.data.user_id);
    const hasArticle = existingArticles.has(item.data.article_id);

    if (!hasUser || !hasArticle) {
      context.totals.valid -= 1;
      context.totals.failed += 1;
      bulkRecords.inc({ entity: 'comments', status: 'fk_error' });
      const errors: Array<{ path: string; message: string }> = [];
      if (!hasUser) errors.push({ path: 'user_id', message: 'Referenced user was not found' });
      if (!hasArticle)
        errors.push({ path: 'article_id', message: 'Referenced article was not found' });
      await createJobError({
        jobId: context.jobId,
        line: item.line,
        externalId: item.data.id,
        code: ImportErrorCode.FK_ERROR,
        errors,
        raw: item.data,
      });
      continue;
    }

    if (batchByExternalId.has(item.data.id)) {
      const first = batchByExternalId.get(item.data.id)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: item.data.id,
      });
      continue;
    }

    if (stagedByExternalId.has(item.data.id)) {
      const first = stagedByExternalId.get(item.data.id)!;
      await recordDuplicateError(context, {
        line: item.line,
        raw: item.data,
        code: ImportErrorCode.DUPLICATE_ID,
        path: 'id',
        message: `Duplicate id in import. First seen at line ${first.line}`,
        externalId: item.data.id,
      });
      continue;
    }

    batchByExternalId.set(item.data.id, { line: item.line, externalId: item.data.id });

    rowsToWrite.push({
      line: item.line,
      externalId: item.data.id,
      payload: {
        externalId: item.data.id,
        articleExternalId: item.data.article_id,
        userExternalId: item.data.user_id,
        body: item.data.body,
        createdAt: item.data.created_at,
      },
    });
  }

  await writeRowsToStaging(context, 'comments', rowsToWrite);
}

export async function flushAllBuffers(
  context: ImportProcessContext,
  buffers: {
    users: UserBufferItem[];
    articles: ArticleBufferItem[];
    comments: CommentBufferItem[];
  },
) {
  await flushUsersBatch(context, buffers.users.splice(0, buffers.users.length));
  await flushArticlesBatch(context, buffers.articles.splice(0, buffers.articles.length));
  await flushCommentsBatch(context, buffers.comments.splice(0, buffers.comments.length));
}
