import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { once } from 'node:events';
import { IMPORT_ALLOWED_ROLES } from '../../domain/auth/types';
import { BadRequestError } from '../../domain/errors';
import { requireAuth } from './authGuard';
import { parseBulkEntity, parseBulkFormat } from './importExportRequestParsers';
import {
  createImportJobFromUpload,
  createImportJobFromUrl,
  getImportJobView,
  iterateImportJobErrors,
} from '../../application/import/service';

type ImportCreateBody = {
  resource?: string;
  format?: string;
  url?: string;
};

function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  return (
    (request.headers['idempotency-key'] as string | undefined)?.trim() ||
    undefined
  );
}

function importJobUrls(jobId: string) {
  return {
    statusUrl: `/v1/imports/${jobId}`,
    errorsUrl: `/v1/imports/${jobId}/errors`,
  };
}

function sendImportJobResponse(
  reply: FastifyReply,
  result: { jobId: string; idempotent: boolean },
) {
  return reply
    .code(result.idempotent ? 200 : 202)
    .send({ jobId: result.jobId, ...importJobUrls(result.jobId) });
}

async function parseMultipartImportRequest(request: FastifyRequest): Promise<{
  entity: ReturnType<typeof parseBulkEntity>;
  format: ReturnType<typeof parseBulkFormat>;
  fileStream: NodeJS.ReadableStream;
}> {
  const part = await request.file();
  if (!part) {
    throw new BadRequestError('file is required in multipart upload');
  }

  const resource = multipartFieldValue(part.fields.resource);
  const format = multipartFieldValue(part.fields.format);

  if (!resource) {
    throw new BadRequestError('resource field is required in multipart upload');
  }

  if (!format) {
    throw new BadRequestError('format field is required in multipart upload');
  }

  return {
    entity: parseBulkEntity(String(resource)),
    format: parseBulkFormat(String(format)),
    fileStream: part.file,
  };
}

function multipartFieldValue(field: unknown): string | undefined {
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || typeof first !== 'object') return undefined;
  if ((first as { type?: unknown }).type !== 'field') return undefined;
  const value = (first as { value?: unknown }).value;
  return value == null ? undefined : String(value);
}

function validateJsonImportBody(body: ImportCreateBody) {
  if (!body.url || body.url.trim().length === 0) {
    throw new BadRequestError(
      'Expected application/json body with non-empty { url, resource }',
    );
  }

  if (!body.resource) {
    throw new BadRequestError('resource is required');
  }
}

export async function importRoutes(app: FastifyInstance) {
  app.post(
    '/v1/imports',
    { preHandler: requireAuth(IMPORT_ALLOWED_ROLES) },
    async (request, reply) => {
      const actor = request.authUser!;
      const idempotencyKey = idempotencyKeyOf(request);

      if (request.isMultipart()) {
        const payload = await parseMultipartImportRequest(request);

        const result = await createImportJobFromUpload({
          actor,
          entity: payload.entity,
          format: payload.format,
          fileStream: payload.fileStream,
          idempotencyKey,
        });

        return sendImportJobResponse(reply, result);
      }

      const body = (request.body ?? {}) as ImportCreateBody;

      validateJsonImportBody(body);

      const result = await createImportJobFromUrl({
        actor,
        entity: parseBulkEntity(body.resource),
        format: parseBulkFormat(body.format),
        url: body.url!,
        idempotencyKey,
      });

      return sendImportJobResponse(reply, result);
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/imports/:jobId',
    { preHandler: requireAuth(IMPORT_ALLOWED_ROLES) },
    async (request) => {
      const actor = request.authUser!;
      const { jobId } = request.params;

      const view = await getImportJobView({ actor, jobId });

      return {
        ...view,
        errorsUrl: importJobUrls(jobId).errorsUrl,
      };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/imports/:jobId/errors',
    { preHandler: requireAuth(IMPORT_ALLOWED_ROLES) },
    async (request, reply) => {
      const actor = request.authUser!;
      const { jobId } = request.params;

      reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="import-errors-${jobId}.ndjson"`,
      );

      for await (const chunk of iterateImportJobErrors({ actor, jobId })) {
        if (!reply.raw.write(chunk)) {
          await once(reply.raw, 'drain');
        }
      }

      reply.raw.end();
    },
  );
}
