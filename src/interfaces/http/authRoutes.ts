import type { FastifyInstance } from 'fastify';
import {
  registerAuthUser,
  loginAuthUser,
} from '../../application/auth/service';
import { env } from '../../infrastructure/config/env';

const registerSchema = {
  description:
    'Register a new user. The first user is automatically promoted to admin.',
  tags: ['Auth'],
  body: {
    type: 'object',
    required: ['email', 'name', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      role: { type: 'string', enum: ['admin', 'author', 'moderator', 'user'] },
    },
  },
} as const;

const loginSchema = {
  description: 'Obtain a JWT token.',
  tags: ['Auth'],
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
} as const;

export async function authRoutes(app: FastifyInstance) {
  const authRateLimit = {
    max: env.AUTH_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  };

  app.post(
    '/v1/auth/register',
    { schema: registerSchema, config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        name: string;
        password: string;
        role?: 'admin' | 'author' | 'moderator' | 'user';
      };

      const user = await registerAuthUser({
        email: body.email,
        name: body.name,
        password: body.password,
        role: body.role,
      });

      const token = await reply.jwtSign({
        sub: user.id,
        role: user.role,
        email: user.email,
      });

      return reply.code(201).send({ user, token });
    },
  );

  app.post(
    '/v1/auth/login',
    { schema: loginSchema, config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };

      const user = await loginAuthUser({
        email: body.email,
        password: body.password,
      });

      const token = await reply.jwtSign({
        sub: user.id,
        role: user.role,
        email: user.email,
      });

      return reply.send({ user, token });
    },
  );
}
