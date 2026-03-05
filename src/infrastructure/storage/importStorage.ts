import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { env } from '../config/env';
import type { BulkEntity, BulkFormat } from '../../domain/importExport/types';
import {
  BadRequestError,
  BadGatewayError,
  GatewayTimeoutError,
  PayloadTooLargeError,
} from '../../domain/errors';

function isSafeRemoteUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchWithRedirects(url: string, signal: AbortSignal) {
  let currentUrl = url;

  for (let i = 0; i < 5; i++) {
    const res = await fetch(currentUrl, {
      signal,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new BadGatewayError('Redirect without location header');
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return res;
  }

  throw new BadGatewayError('Too many redirects');
}

async function writeFile(
  source: NodeJS.ReadableStream,
  path: string,
  headers: Headers,
) {
  const hash = createHash('sha256');
  let bytes = 0;

  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;

      if (bytes > env.IMPORT_MAX_FILE_BYTES) {
        return cb(new PayloadTooLargeError('File too large'));
      }

      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(source, limiter, createWriteStream(path));
  } catch (err) {
    await rm(path, { force: true });
    throw err;
  }

  return {
    sha256: hash.digest('hex'),
    bytes,
    gzip: headers.get('content-encoding') === 'gzip',
  };
}

export async function downloadImportFile(input: {
  jobId: string;
  url: string;
  entity: BulkEntity;
  format: BulkFormat;
}) {
  if (!isSafeRemoteUrl(input.url)) {
    throw new BadRequestError('Invalid URL');
  }

  const dir = join(env.STORAGE_DIR, 'imports');
  mkdirSync(dir, { recursive: true });

  const path = join(dir, `${input.jobId}.${input.entity}.${input.format}`);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.IMPORT_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetchWithRedirects(input.url, controller.signal);

    clearTimeout(timeout);

    if (!response.ok || !response.body) {
      throw new BadGatewayError(`Remote responded with ${response.status}`);
    }

    const nodeStream = Readable.fromWeb(response.body as any);

    const result = await writeFile(nodeStream, path, response.headers);

    return { path, ...result };
  } catch (err: any) {
    clearTimeout(timeout);

    if (err.name === 'AbortError') {
      throw new GatewayTimeoutError('Remote fetch timeout');
    }

    if (err instanceof PayloadTooLargeError) {
      throw err;
    }

    throw new BadGatewayError('Failed to fetch file');
  }
}

export async function storeIncomingImportFile(input: {
  jobId: string;
  source: NodeJS.ReadableStream;
  entity: BulkEntity;
  format: BulkFormat;
}) {
  const dir = join(env.STORAGE_DIR, 'imports');
  mkdirSync(dir, { recursive: true });

  const path = join(dir, `${input.jobId}.${input.entity}.${input.format}`);

  const result = await writeFile(input.source, path, new Headers());

  return { path, ...result };
}

export function exportOutputPath(input: {
  jobId: string;
  entity: BulkEntity;
  format: BulkFormat;
}) {
  const dir = join(env.STORAGE_DIR, 'exports');
  mkdirSync(dir, { recursive: true });

  return join(dir, `${input.jobId}.${input.entity}.${input.format}`);
}

export function buildExportFileName(
  jobId: string,
  entity: string,
  format: string,
) {
  return `export-${jobId}.${entity}.${format}`;
}
