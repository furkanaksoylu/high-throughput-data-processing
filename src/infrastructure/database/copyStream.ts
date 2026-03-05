import { type PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { BulkEntity } from '../../domain/importExport/types';

function csvEscape(value: string) {
  if (
    value.includes('"') ||
    value.includes(',') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsvRow(values: (string | number)[]) {
  return (
    values
      .map((v) => (typeof v === 'number' ? String(v) : csvEscape(v)))
      .join(',') + '\n'
  );
}

export async function openCopyStream(client: PoolClient, entity: BulkEntity) {
  const stagingTables: Record<BulkEntity, string> = {
    users: 'stg_users',
    articles: 'stg_articles',
    comments: 'stg_comments',
  };
  const table = stagingTables[entity];

  const sql = `COPY ${table} (job_id, line, external_id, payload) FROM STDIN WITH (FORMAT csv)`;
  const stream = client.query(copyFrom(sql));

  const writeRow = (
    jobId: string,
    line: number,
    externalId: string,
    payload: unknown,
  ) => {
    return stream.write(
      buildCsvRow([jobId, line, externalId, JSON.stringify(payload)]),
    );
  };

  const finish = () =>
    new Promise<void>((resolve, reject) => {
      stream.once('finish', () => resolve());
      stream.once('error', (e) => reject(e));
      stream.end();
    });

  const drain = () =>
    new Promise<void>((resolve) => stream.once('drain', () => resolve()));

  return { stream, writeRow, finish, drain };
}
