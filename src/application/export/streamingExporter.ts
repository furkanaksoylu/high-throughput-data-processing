import { BadRequestError } from '../../domain/errors';
import type { BulkEntity, BulkFormat, ExportFilters } from '../../domain/importExport/types';
import { env } from '../../infrastructure/config/env';
import { bulkExportRows } from '../../infrastructure/observability/metrics';
import { prisma } from '../../infrastructure/prisma/client';
import {
  contentTypeForFormat,
  decodeCursor,
  encodeCursor,
  toDto,
  type ArticleExportRow,
  type CommentExportRow,
  type ExportRow,
  type UserExportRow,
} from './exportDto';
import { buildArticlesWhere, buildCommentsWhere, buildUsersWhere } from './queryBuilder';

async function fetchUsersExportRows(input: {
  filters?: ExportFilters;
  afterId: string | null;
  limit: number;
}): Promise<UserExportRow[]> {
  return prisma.user.findMany({
    where: buildUsersWhere(input.filters, input.afterId),
    select: {
      externalId: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { externalId: 'asc' },
    take: input.limit,
  });
}

async function fetchArticlesExportRows(input: {
  filters?: ExportFilters;
  afterId: string | null;
  limit: number;
}): Promise<ArticleExportRow[]> {
  const rows = await prisma.article.findMany({
    where: buildArticlesWhere(input.filters, input.afterId),
    select: {
      externalId: true,
      slug: true,
      title: true,
      body: true,
      authorExternalId: true,
      tags: true,
      publishedAt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { externalId: 'asc' },
    take: input.limit,
  });
  return rows.map((r) => ({ ...r, tags: (r.tags as string[] | null) ?? [] }));
}

async function fetchCommentsExportRows(input: {
  filters?: ExportFilters;
  afterId: string | null;
  limit: number;
}): Promise<CommentExportRow[]> {
  return prisma.comment.findMany({
    where: buildCommentsWhere(input.filters, input.afterId),
    select: {
      externalId: true,
      articleExternalId: true,
      userExternalId: true,
      body: true,
      createdAt: true,
    },
    orderBy: { externalId: 'asc' },
    take: input.limit,
  });
}

export async function fetchExportRows(input: {
  entity: BulkEntity;
  filters?: ExportFilters;
  afterId: string | null;
  limit: number;
}): Promise<ExportRow[]> {
  if (input.entity === 'users') return fetchUsersExportRows(input);
  if (input.entity === 'articles') return fetchArticlesExportRows(input);
  return fetchCommentsExportRows(input);
}

export async function streamExport(input: {
  entity: BulkEntity;
  format: BulkFormat;
  limit: number;
  cursor?: string;
  writeChunk: (chunk: string) => Promise<void>;
}): Promise<{ contentType: string; nextCursor: string | null; written: number }> {
  if (input.format !== 'ndjson') {
    throw new BadRequestError('streaming export currently supports format=ndjson');
  }

  let afterId = decodeCursor(input.cursor);
  let remaining = input.limit;
  let written = 0;

  while (remaining > 0) {
    const batchLimit = Math.min(env.EXPORT_FETCH_BATCH_SIZE, remaining);
    const rows = await fetchExportRows({
      entity: input.entity,
      filters: undefined,
      afterId,
      limit: batchLimit,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      afterId = row.externalId;
      await input.writeChunk(JSON.stringify(toDto(input.entity, row)) + '\n');
      written += 1;
      bulkExportRows.inc({ entity: input.entity, type: 'streaming' });
    }

    remaining -= rows.length;
    if (rows.length < batchLimit) break;
  }

  return {
    contentType: contentTypeForFormat('ndjson'),
    nextCursor: afterId && written > 0 ? encodeCursor(afterId) : null,
    written,
  };
}
