import { prisma } from '../prisma/client';

export async function findExistingExternalIds(
  table: 'users' | 'articles',
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  if (table === 'users') {
    const rows = await prisma.user.findMany({
      where: { externalId: { in: ids } },
      select: { externalId: true },
    });
    return new Set(rows.map((row) => row.externalId));
  }

  const rows = await prisma.article.findMany({
    where: { externalId: { in: ids } },
    select: { externalId: true },
  });
  return new Set(rows.map((row) => row.externalId));
}

export async function findUserExternalIdsByEmail(
  emails: string[],
): Promise<Map<string, string>> {
  if (emails.length === 0) {
    return new Map();
  }

  const rows = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, externalId: true },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.email, row.externalId);
  }
  return map;
}

export async function findArticleExternalIdsBySlug(
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) {
    return new Map();
  }

  const rows = await prisma.article.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, externalId: true },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.slug) map.set(row.slug, row.externalId);
  }
  return map;
}
