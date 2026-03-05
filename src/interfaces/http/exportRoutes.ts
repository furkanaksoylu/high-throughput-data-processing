import type { FastifyInstance } from 'fastify';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { EXPORT_ALLOWED_ROLES } from '../../domain/auth/types';
import { BadRequestError } from '../../domain/errors';
import type { ExportParams } from '../../domain/importExport/types';
import { requireAuth } from './authGuard';
import {
  normalizeExportFilters,
  parseBulkEntity,
  parseBulkFormat,
} from './importExportRequestParsers';
import {
  enqueueExportJob,
  getExportDownload,
  getExportJobView,
} from '../../application/export/service';
import { streamExport } from '../../application/export/streamingExporter';

function exportJobUrls(jobId: string) {
  return {
    statusUrl: `/v1/exports/${jobId}`,
    downloadUrl: `/v1/exports/${jobId}/download`,
  };
}

function parseExportLimit(rawLimit: unknown): number {
  const parsed = Number(rawLimit ?? 5000);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50_000);
}

export async function exportRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      resource?: string;
      format?: string;
      limit?: string;
      cursor?: string;
    };
  }>(
    '/v1/exports',
    { preHandler: requireAuth(EXPORT_ALLOWED_ROLES) },
    async (request, reply) => {
      const entity = parseBulkEntity(request.query.resource);
      const format = parseBulkFormat(request.query.format, 'ndjson');

      if (format !== 'ndjson') {
        throw new BadRequestError(
          'streaming export currently supports format=ndjson',
        );
      }

      reply.hijack();

      reply.raw.setHeader(
        'Content-Type',
        'application/x-ndjson; charset=utf-8',
      );
      reply.raw.setHeader('Trailer', 'X-Next-Cursor, X-Written-Count');
      reply.raw.flushHeaders();

      let aborted = false;
      reply.raw.on('close', () => {
        aborted = true;
      });

      try {
        const result = await streamExport({
          entity,
          format,
          limit: parseExportLimit(request.query.limit),
          cursor: request.query.cursor,
          writeChunk: async (chunk) => {
            if (aborted) return;

            if (!reply.raw.write(chunk)) {
              await once(reply.raw, 'drain');
            }
          },
        });

        if (!aborted) {
          const trailers: Record<string, string> = {
            'X-Written-Count': String(result.written),
          };

          if (result.nextCursor) {
            trailers['X-Next-Cursor'] = result.nextCursor;
          }

          reply.raw.addTrailers(trailers);
          reply.raw.end();
        }
      } catch (err) {
        if (!aborted) {
          reply.raw.destroy(err as Error);
        }
      }
    },
  );

  app.post(
    '/v1/exports',
    { preHandler: requireAuth(EXPORT_ALLOWED_ROLES) },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = request.body as {
        resource: string;
        format?: string;
        filters?: Record<string, unknown>;
        fields?: string[];
      };

      const params: ExportParams = {
        filters: normalizeExportFilters(body.filters ?? {}),
        fields: body.fields,
      };

      const { jobId } = await enqueueExportJob({
        actor,
        entity: parseBulkEntity(body.resource),
        format: parseBulkFormat(body.format, 'ndjson'),
        params,
      });

      return reply.code(202).send({ jobId, ...exportJobUrls(jobId) });
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/exports/:jobId',
    { preHandler: requireAuth(EXPORT_ALLOWED_ROLES) },
    async (request) => {
      const actor = request.authUser!;
      const { jobId } = request.params;

      const view = await getExportJobView({ actor, jobId });

      return {
        ...view,
        downloadUrl: view.hasDownload ? exportJobUrls(jobId).downloadUrl : null,
      };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/exports/:jobId/download',
    { preHandler: requireAuth(EXPORT_ALLOWED_ROLES) },
    async (request, reply) => {
      const actor = request.authUser!;
      const { jobId } = request.params;

      const downloadable = await getExportDownload({ actor, jobId });

      if (!downloadable) {
        return reply.code(404).send({
          error: 'export file not available yet',
        });
      }

      reply.raw.setHeader('Content-Type', downloadable.contentType);
      reply.raw.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadable.fileName}"`,
      );

      try {
        await pipeline(createReadStream(downloadable.path), reply.raw);
      } catch (err) {
        reply.raw.destroy(err as Error);
      }
    },
  );
}
