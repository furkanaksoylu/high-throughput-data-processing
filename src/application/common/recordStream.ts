import { Readable } from 'node:stream';
import { chain } from 'stream-chain';
import split2 from 'split2';
import type { BulkFormat } from '../../domain/importExport/types';
import { streamJsonArray } from './jsonArrayStream';

export async function* streamInputRecords(opts: {
  source: Readable;
  format: BulkFormat;
}): AsyncGenerator<{ line: number; raw: unknown; parseError?: string }> {
  let line = 0;

  if (opts.format === 'json') {
    try {
      for await (const raw of streamJsonArray(opts.source)) {
        line += 1;
        yield { line, raw };
      }
    } catch (error: unknown) {
      line += 1;
      yield {
        line,
        raw: null,
        parseError:
          error instanceof Error ? error.message : 'Invalid JSON payload',
      };
    }
    return;
  }

  if (opts.format === 'csv') {
    const pipeline = chain([opts.source, split2()]);
    let sourceLine = 0;
    let header: string[] | null = null;

    for await (const lineChunk of pipeline) {
      sourceLine += 1;
      const text = String(lineChunk).replace(/\r$/, '');
      if (!text.trim()) continue;

      const parsed = parseCsvLine(text);
      if (parsed.error) {
        yield {
          line: sourceLine,
          raw: text.slice(0, 4000),
          parseError: parsed.error,
        };
        continue;
      }

      if (!header) {
        header = parsed.values.map((value, i) =>
          i === 0 ? value.trim().replace(/^\uFEFF/, '') : value.trim(),
        );
        continue;
      }

      if (parsed.values.length !== header.length) {
        yield {
          line: sourceLine,
          raw: text.slice(0, 4000),
          parseError: 'Invalid CSV row: column count does not match header',
        };
        continue;
      }

      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) {
        row[header[i]] = parsed.values[i] ?? '';
      }
      yield { line: sourceLine, raw: row };
    }
    return;
  }

  const pipeline = chain([
    opts.source,
    split2(),
  ]);

  for await (const lineChunk of pipeline) {
    const text = String(lineChunk).trim();
    if (!text) continue;

    line += 1;

    try {
      yield { line, raw: JSON.parse(text) };
    } catch {
      yield {
        line,
        raw: text.slice(0, 4000),
        parseError: 'Invalid NDJSON line',
      };
    }
  }
}

function parseCsvLine(line: string): { values: string[]; error?: string } {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === ',') {
      values.push(current);
      current = '';
      continue;
    }

    if (ch === '"') {
      if (current.length > 0) {
        return { values: [], error: 'Invalid CSV row: unexpected quote' };
      }
      inQuotes = true;
      continue;
    }

    current += ch;
  }

  if (inQuotes) {
    return { values: [], error: 'Invalid CSV row: unterminated quote' };
  }

  values.push(current);
  return { values };
}
