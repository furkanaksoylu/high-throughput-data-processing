import { z } from "zod";
import type { BulkEntity } from "./types";
import { AUTH_ROLES } from "../auth/types";

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTICLE_STATUSES = ["draft", "published", "archived"] as const;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined | unknown {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

export const UserImportSchema = z.object({
  id: z.string().trim().min(1).optional(),
  email: z.string().email("email must be valid").transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  role: z.enum(AUTH_ROLES).default("user"),
  active: z.boolean().default(true),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});

export const ArticleImportSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(KEBAB_CASE_RE, "slug must be kebab-case"),
    title: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1),
    author_id: z.string().trim().min(1),
    tags: z.array(z.string()).default([]),
    published_at: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(ARTICLE_STATUSES).default("draft"),
    created_at: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "draft" && data.published_at != null) {
      ctx.addIssue({
        path: ["published_at"],
        code: z.ZodIssueCode.custom,
        message: "draft articles must not have published_at",
      });
    }
  });

export const CommentImportSchema = z.object({
  id: z.string().trim().min(1),
  article_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  body: z
    .string()
    .trim()
    .min(1)
    .refine((value) => wordCount(value) <= 500, "body must not exceed 500 words"),
  created_at: z.string().datetime({ offset: true }).optional(),
});

export type UserImportRecord = z.infer<typeof UserImportSchema>;
export type ArticleImportRecord = z.infer<typeof ArticleImportSchema>;
export type CommentImportRecord = z.infer<typeof CommentImportSchema>;

function normalizeUser(raw: Record<string, unknown>) {
  return {
    id: optionalString(raw.id ?? raw.externalId),
    email: raw.email,
    name: raw.name,
    role: raw.role,
    active: optionalBoolean(raw.active),
    created_at: optionalString(raw.created_at ?? raw.createdAt),
    updated_at: optionalString(raw.updated_at ?? raw.updatedAt),
  };
}

function normalizeArticle(raw: Record<string, unknown>) {
  return {
    id: optionalString(raw.id ?? raw.externalId),
    slug: raw.slug,
    title: raw.title,
    body: raw.body,
    author_id: (raw.author_id ?? raw.authorId ?? raw.author_external_id ?? raw.authorExternalId) as
      | string
      | undefined,
    tags: raw.tags,
    published_at: optionalString(raw.published_at ?? raw.publishedAt),
    status: raw.status,
    created_at: optionalString(raw.created_at ?? raw.createdAt),
    updated_at: optionalString(raw.updated_at ?? raw.updatedAt),
  };
}

function normalizeComment(raw: Record<string, unknown>) {
  return {
    id: optionalString(raw.id ?? raw.externalId),
    article_id: (raw.article_id ?? raw.articleId ?? raw.article_external_id ?? raw.articleExternalId) as
      | string
      | undefined,
    user_id: (raw.user_id ?? raw.userId ?? raw.user_external_id ?? raw.userExternalId) as
      | string
      | undefined,
    body: raw.body,
    created_at: optionalString(raw.created_at ?? raw.createdAt),
  };
}

export function validateImportRecord(entity: BulkEntity, raw: unknown) {
  const input = (raw ?? {}) as Record<string, unknown>;

  if (entity === "users") {
    return UserImportSchema.safeParse(normalizeUser(input));
  }
  if (entity === "articles") {
    return ArticleImportSchema.safeParse(normalizeArticle(input));
  }
  return CommentImportSchema.safeParse(normalizeComment(input));
}
