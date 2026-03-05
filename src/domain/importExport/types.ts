export type BulkEntity = "users" | "articles" | "comments";
export type BulkFormat = "ndjson" | "json" | "csv";
export type JobType = "import" | "export";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export type ExportFilters = {
  status?: string;
  active?: boolean;
  role?: string;
  author_id?: string;
  article_id?: string;
  user_id?: string;
  published_before?: string;
  published_after?: string;
};

export type ExportParams = {
  filters?: ExportFilters;
  fields?: string[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};
