import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import type { BulkEntity } from '../../domain/importExport/types';

export type StagingTable = 'stg_users' | 'stg_articles' | 'stg_comments';
export type StagedPointer = { line: number; externalId: string };
export type SlugConflict = { line: number; external_id: string; slug: string };

export function stagingTableForEntity(entity: BulkEntity): StagingTable {
  return entity === 'users'
    ? 'stg_users'
    : entity === 'articles'
      ? 'stg_articles'
      : 'stg_comments';
}

export async function deleteStagingRows(table: StagingTable, jobId: string) {
  if (table === 'stg_users') {
    await prisma.stgUser.deleteMany({ where: { jobId } });
    return;
  }
  if (table === 'stg_articles') {
    await prisma.stgArticle.deleteMany({ where: { jobId } });
    return;
  }
  await prisma.stgComment.deleteMany({ where: { jobId } });
}

export async function countStagingRows(
  table: StagingTable,
  jobId: string,
): Promise<number> {
  if (table === 'stg_users') {
    return prisma.stgUser.count({ where: { jobId } });
  }
  if (table === 'stg_articles') {
    return prisma.stgArticle.count({ where: { jobId } });
  }
  return prisma.stgComment.count({ where: { jobId } });
}

export async function findStagedExternalIdPointers(
  table: StagingTable,
  jobId: string,
  externalIds: string[],
): Promise<Map<string, StagedPointer>> {
  if (externalIds.length === 0) {
    return new Map();
  }

  const rows =
    table === 'stg_users'
      ? await prisma.stgUser.findMany({
          where: { jobId, externalId: { in: externalIds } },
          select: { externalId: true, line: true },
          orderBy: { line: 'asc' },
        })
      : table === 'stg_articles'
        ? await prisma.stgArticle.findMany({
            where: { jobId, externalId: { in: externalIds } },
            select: { externalId: true, line: true },
            orderBy: { line: 'asc' },
          })
        : await prisma.stgComment.findMany({
            where: { jobId, externalId: { in: externalIds } },
            select: { externalId: true, line: true },
            orderBy: { line: 'asc' },
          });

  const pointers = new Map<string, StagedPointer>();
  for (const row of rows) {
    if (!pointers.has(row.externalId)) {
      pointers.set(row.externalId, {
        line: row.line,
        externalId: row.externalId,
      });
    }
  }
  return pointers;
}

export async function findStagedUsersByEmail(
  jobId: string,
  emails: string[],
): Promise<Map<string, StagedPointer>> {
  if (emails.length === 0) {
    return new Map();
  }

  const rows = await prisma.stgUser.findMany({
    where: {
      jobId,
      OR: emails.map((email) => ({
        payload: { path: ['email'], equals: email },
      })),
    },
    select: { line: true, externalId: true, payload: true },
    orderBy: { line: 'asc' },
  });

  const pointers = new Map<string, StagedPointer>();
  for (const row of rows) {
    const payload = row.payload as Record<string, unknown>;
    const email = typeof payload?.email === 'string' ? payload.email : null;
    if (email && !pointers.has(email)) {
      pointers.set(email, { line: row.line, externalId: row.externalId });
    }
  }
  return pointers;
}

export async function findAndDeleteSlugConflicts(
  jobId: string,
): Promise<SlugConflict[]> {
  const stagedRows = await prisma.stgArticle.findMany({
    where: { jobId },
    select: { line: true, externalId: true, payload: true },
    orderBy: { line: 'asc' },
  });

  const slugCandidates = new Set<string>();
  for (const row of stagedRows) {
    const payload = row.payload as Record<string, unknown>;
    const slug = typeof payload?.slug === 'string' ? payload.slug : null;
    if (slug) slugCandidates.add(slug);
  }

  const existingRows = slugCandidates.size
    ? await prisma.article.findMany({
        where: { slug: { in: Array.from(slugCandidates) } },
        select: { slug: true, externalId: true },
      })
    : [];

  const existingBySlug = new Map<string, string>();
  for (const row of existingRows) {
    if (row.slug) existingBySlug.set(row.slug, row.externalId);
  }

  const firstStagedBySlug = new Map<
    string,
    { line: number; externalId: string }
  >();
  const conflicts: SlugConflict[] = [];

  for (const row of stagedRows) {
    const payload = row.payload as Record<string, unknown>;
    const slug = typeof payload?.slug === 'string' ? payload.slug : null;
    if (!slug) continue;

    const existingExternalId = existingBySlug.get(slug);
    if (existingExternalId && existingExternalId !== row.externalId) {
      conflicts.push({ line: row.line, external_id: row.externalId, slug });
      continue;
    }

    const first = firstStagedBySlug.get(slug);
    if (!first) {
      firstStagedBySlug.set(slug, {
        line: row.line,
        externalId: row.externalId,
      });
      continue;
    }
    if (first.externalId !== row.externalId) {
      conflicts.push({ line: row.line, external_id: row.externalId, slug });
    }
  }

  if (conflicts.length > 0) {
    await prisma.stgArticle.deleteMany({
      where: { jobId, line: { in: conflicts.map((c) => c.line) } },
    });
  }

  return conflicts;
}
