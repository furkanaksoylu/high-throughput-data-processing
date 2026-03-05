import type {
  BulkEntity,
  BulkFormat,
  ExportFilters,
} from '../../domain/importExport/types';
import { BadRequestError } from '../../domain/errors';

const VALID_ENTITIES = new Set<BulkEntity>(['users', 'articles', 'comments']);
const VALID_FORMATS = new Set<BulkFormat>(['ndjson', 'json', 'csv']);

export function parseBulkEntity(value: unknown): BulkEntity {
  if (typeof value === 'string' && VALID_ENTITIES.has(value as BulkEntity)) {
    return value as BulkEntity;
  }
  throw new BadRequestError(
    'resource must be one of: users, articles, comments',
  );
}

export function parseBulkFormat(
  value: unknown,
  fallback: BulkFormat = 'ndjson',
): BulkFormat {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value === 'string' && VALID_FORMATS.has(value as BulkFormat)) {
    return value as BulkFormat;
  }
  throw new BadRequestError('format must be one of: ndjson, json, csv');
}

export function normalizeExportFilters(raw: unknown): ExportFilters {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    status: typeof source.status === 'string' ? source.status : undefined,
    active: typeof source.active === 'boolean' ? source.active : undefined,
    role: typeof source.role === 'string' ? source.role : undefined,
    author_id:
      typeof (
        source.author_id ??
        source.authorId ??
        source.authorExternalId
      ) === 'string'
        ? ((source.author_id ??
            source.authorId ??
            source.authorExternalId) as string)
        : undefined,
    article_id:
      typeof (
        source.article_id ??
        source.articleId ??
        source.articleExternalId
      ) === 'string'
        ? ((source.article_id ??
            source.articleId ??
            source.articleExternalId) as string)
        : undefined,
    user_id:
      typeof (source.user_id ?? source.userId ?? source.userExternalId) ===
      'string'
        ? ((source.user_id ?? source.userId ?? source.userExternalId) as string)
        : undefined,
    published_before:
      typeof (source.published_before ?? source.publishedBefore) === 'string'
        ? ((source.published_before ?? source.publishedBefore) as string)
        : undefined,
    published_after:
      typeof (source.published_after ?? source.publishedAfter) === 'string'
        ? ((source.published_after ?? source.publishedAfter) as string)
        : undefined,
  };
}
