import { describe, it, expect } from "vitest";
import {
  UserImportSchema,
  ArticleImportSchema,
  CommentImportSchema,
  validateImportRecord,
} from "../../src/domain/importExport/validation";

describe("UserSchema", () => {
  it("accepts valid payload with natural key", () => {
    const result = UserImportSchema.safeParse({
      email: "alice@example.com",
      name: "Alice",
      role: "user",
      active: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts optional id for upsert", () => {
    const result = UserImportSchema.safeParse({
      id: "u-1",
      email: "alice@example.com",
      name: "Alice",
      role: "author",
      active: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts optional created_at and updated_at", () => {
    const result = UserImportSchema.safeParse({
      id: "u-1",
      email: "alice@example.com",
      name: "Alice",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = UserImportSchema.safeParse({ id: "u-1", email: "x", name: "Alice" });
    expect(result.success).toBe(false);
  });
});

describe("ArticleSchema", () => {
  const base = {
    id: "a-1",
    slug: "hello-world",
    title: "Hello",
    body: "Body",
    author_id: "u-1",
  };

  it("accepts valid draft article", () => {
    const result = ArticleImportSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects draft with published_at", () => {
    const result = ArticleImportSchema.safeParse({
      ...base,
      status: "draft",
      published_at: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-kebab slug", () => {
    const result = ArticleImportSchema.safeParse({ ...base, slug: "Hello World" });
    expect(result.success).toBe(false);
  });

  it("accepts optional created_at and updated_at", () => {
    const result = ArticleImportSchema.safeParse({
      ...base,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("CommentSchema", () => {
  it("accepts valid comment", () => {
    const result = CommentImportSchema.safeParse({
      id: "c-1",
      article_id: "a-1",
      user_id: "u-1",
      body: "Great post",
    });

    expect(result.success).toBe(true);
  });

  it("rejects body over 500 words", () => {
    const body = Array.from({ length: 501 }, (_, index) => `w${index}`).join(" ");
    const result = CommentImportSchema.safeParse({
      id: "c-1",
      article_id: "a-1",
      user_id: "u-1",
      body,
    });

    expect(result.success).toBe(false);
  });
});

describe("validateEntity", () => {
  it("dispatches user validation", () => {
    const result = validateImportRecord("users", {
      email: "one@example.com",
      name: "One",
    });
    expect(result.success).toBe(true);
  });

  it("dispatches article validation", () => {
    const result = validateImportRecord("articles", {
      slug: "post-1",
      title: "Post",
      body: "Body",
      author_id: "u-1",
    });
    expect(result.success).toBe(true);
  });

  it("dispatches comment validation", () => {
    const result = validateImportRecord("comments", {
      id: "c-1",
      article_id: "a-1",
      user_id: "u-1",
      body: "Body",
    });
    expect(result.success).toBe(true);
  });
});
