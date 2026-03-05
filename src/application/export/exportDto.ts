import type { BulkEntity, BulkFormat } from '../../domain/importExport/types';

export type UserExportRow = {
  externalId: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ArticleExportRow = {
  externalId: string;
  slug: string | null;
  title: string;
  body: string;
  authorExternalId: string;
  tags: string[];
  publishedAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentExportRow = {
  externalId: string;
  articleExternalId: string;
  userExternalId: string;
  body: string;
  createdAt: Date;
};

export type ExportRow = UserExportRow | ArticleExportRow | CommentExportRow;

export function contentTypeForFormat(format: BulkFormat): string {
  return format === 'json'
    ? 'application/json; charset=utf-8'
    : 'application/x-ndjson; charset=utf-8';
}

export function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): string | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}

export function allowedFields(entity: BulkEntity): string[] {
  if (entity === 'users') {
    return ['id', 'email', 'name', 'role', 'active', 'created_at', 'updated_at'];
  }
  if (entity === 'articles') {
    return [
      'id',
      'slug',
      'title',
      'body',
      'author_id',
      'tags',
      'published_at',
      'status',
      'created_at',
      'updated_at',
    ];
  }
  return ['id', 'article_id', 'user_id', 'body', 'created_at'];
}

export function toDto(entity: BulkEntity, row: ExportRow): Record<string, unknown> {
  if (entity === 'users') {
    const user = row as UserExportRow;
    return {
      id: user.externalId,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }
  if (entity === 'articles') {
    const article = row as ArticleExportRow;
    return {
      id: article.externalId,
      slug: article.slug,
      title: article.title,
      body: article.body,
      author_id: article.authorExternalId,
      tags: article.tags,
      published_at: article.publishedAt,
      status: article.status,
      created_at: article.createdAt,
      updated_at: article.updatedAt,
    };
  }
  const comment = row as CommentExportRow;
  return {
    id: comment.externalId,
    article_id: comment.articleExternalId,
    user_id: comment.userExternalId,
    body: comment.body,
    created_at: comment.createdAt,
  };
}

export function applyFieldProjection(
  entity: BulkEntity,
  dto: Record<string, unknown>,
  fields?: string[],
): Record<string, unknown> {
  if (!fields || fields.length === 0) return dto;

  const whitelist = new Set(allowedFields(entity));
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (whitelist.has(field) && Object.prototype.hasOwnProperty.call(dto, field)) {
      projected[field] = dto[field];
    }
  }
  return projected;
}
