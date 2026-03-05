import Fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import scalarReference from '@scalar/fastify-api-reference';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/observability/logger';
import { redis } from '../../infrastructure/redis/client';
import {
  register as metricsRegistry,
  httpRequestDuration,
} from '../../infrastructure/observability/metrics';
import { AppError } from '../../domain/errors';
import { authRoutes } from './authRoutes';
import { importRoutes } from './importRoutes';
import { exportRoutes } from './exportRoutes';

export async function createApp() {
  const app = Fastify({ logger });

  if (env.DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Bulk Import/Export API', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    await app.register(scalarReference, { routePrefix: '/docs' });
  }

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  await app.register(multipart, {
    limits: { files: 1, fileSize: env.IMPORT_MAX_FILE_BYTES },
  });

  await app.register(rateLimit, {
    global: false,
    redis,
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions?.url ?? request.url;
    httpRequestDuration
      .labels(request.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    const validationErrors = (error as { validation?: unknown }).validation;
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      type AjvIssue = { message?: string };
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (validationErrors as AjvIssue[]).map((e) => ({
          message: e.message ?? 'invalid value',
        })),
      });
    }

    requestLogError(error, request);

    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
    });
  });

  await app.register(authRoutes);
  await app.register(importRoutes);
  await app.register(exportRoutes);

  app.get('/healthz', async () => ({ ok: true }));

  if (env.METRICS_ENABLED) {
    app.get('/metrics', { logLevel: 'silent' }, async (request, reply) => {
      if (env.METRICS_TOKEN) {
        const auth = (request.headers.authorization ?? '').trim();
        const expected = `Bearer ${env.METRICS_TOKEN}`;
        if (auth !== expected) {
          return reply
            .code(401)
            .send({ error: 'UNAUTHORIZED', message: 'Invalid metrics token' });
        }
      }

      reply.header('Content-Type', metricsRegistry.contentType);
      return metricsRegistry.metrics();
    });
  }

  return app;
}

function requestLogError(error: unknown, request: FastifyRequest) {
  const path = request.url.split('?')[0];
  if (path === '/metrics') return;

  const err = error as { message?: string; stack?: string };

  logger.error({
    msg: 'request_error',
    method: request.method,
    url: request.url,
    err: err?.message,
    stack: err?.stack,
  });
}
