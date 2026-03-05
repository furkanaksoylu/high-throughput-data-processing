import type { Prisma } from '@prisma/client';
import { BadRequestError } from '../../domain/errors';
import type { ExportFilters } from '../../domain/importExport/types';

function parseFilterDate(value: string, field: 'published_before' | 'published_after'): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`${field} must be a valid datetime`);
  }
  return parsed;
}

export function buildUsersWhere(
  filters: ExportFilters | undefined,
  afterId: string | null,
): Prisma.UserWhereInput {
  return {
    ...(filters?.active !== undefined ? { active: filters.active } : {}),
    ...(filters?.role ? { role: filters.role } : {}),
    ...(afterId ? { externalId: { gt: afterId } } : {}),
  };
}

export function buildArticlesWhere(
  filters: ExportFilters | undefined,
  afterId: string | null,
): Prisma.ArticleWhereInput {
  const publishedAtGt = filters?.published_after
    ? parseFilterDate(filters.published_after, 'published_after')
    : undefined;
  const publishedAtLt = filters?.published_before
    ? parseFilterDate(filters.published_before, 'published_before')
    : undefined;

  return {
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.author_id ? { authorExternalId: filters.author_id } : {}),
    ...(publishedAtGt || publishedAtLt
      ? {
          publishedAt: {
            ...(publishedAtGt ? { gt: publishedAtGt } : {}),
            ...(publishedAtLt ? { lt: publishedAtLt } : {}),
          },
        }
      : {}),
    ...(afterId ? { externalId: { gt: afterId } } : {}),
  };
}

export function buildCommentsWhere(
  filters: ExportFilters | undefined,
  afterId: string | null,
): Prisma.CommentWhereInput {
  return {
    ...(filters?.article_id ? { articleExternalId: filters.article_id } : {}),
    ...(filters?.user_id ? { userExternalId: filters.user_id } : {}),
    ...(afterId ? { externalId: { gt: afterId } } : {}),
  };
}
