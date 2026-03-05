import type { PoolClient } from 'pg';
import type { BulkEntity } from '../../domain/importExport/types';
import type {
  ArticleImportRecord,
  CommentImportRecord,
  UserImportRecord,
} from '../../domain/importExport/validation';

export type ProgressTotals = {
  read: number;
  valid: number;
  failed: number;
  written: number;
};

export type ImportProcessContext = {
  copyClient: PoolClient;
  jobId: string;
  entity: BulkEntity;
  totals: ProgressTotals;
};

export type UserBufferItem = { line: number; data: UserImportRecord };
export type ArticleBufferItem = { line: number; data: ArticleImportRecord };
export type CommentBufferItem = { line: number; data: CommentImportRecord };

export type StagingWriteRow = {
  line: number;
  externalId: string;
  payload: Record<string, unknown>;
};

export type ImportErrorRow = {
  id: string;
  jobId: string;
  line: number | null;
  externalId: string | null;
  code: string;
  errors: unknown;
  raw: unknown;
  createdAt: Date;
};
