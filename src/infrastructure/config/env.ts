import 'dotenv/config';
import { z } from 'zod';

const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

const EnvBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) {
      return true;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (TRUE_ENV_VALUES.has(normalized)) {
      return true;
    }
    if (FALSE_ENV_VALUES.has(normalized)) {
      return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must be one of: true/false, 1/0, yes/no, on/off',
    });
    return z.NEVER;
  });

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('app'),
  DB_PASS: z.string().default('app'),
  DB_NAME: z.string().default('app'),
  DB_POOL_MAX: z.coerce.number().default(10),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  STORAGE_DIR: z.string().default('/data'),

  BULK_QUEUE_NAME: z.string().default('bulk'),
  BULK_WORKER_CONCURRENCY: z.coerce.number().default(2),
  JOB_RECOVERY_EVERY_MS: z.coerce.number().positive().default(30000),
  STALE_JOB_TIMEOUT_MS: z.coerce.number().positive().default(1800000),

  JOB_PROGRESS_EVERY: z.coerce.number().default(5000),
  IMPORT_FLUSH_SIZE: z.coerce.number().int().positive().default(1000),
  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .positive()
    .default(1024 * 1024 * 1024),
  IMPORT_FETCH_TIMEOUT_MS: z.coerce.number().positive().default(30000),
  EXPORT_FETCH_BATCH_SIZE: z.coerce.number().int().positive().default(1000),

  METRICS_ENABLED: EnvBoolean,
  METRICS_TOKEN: z.string().optional(),
  WORKER_METRICS_PORT: z.coerce.number().default(9091),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  DOCS_ENABLED: EnvBoolean,
  SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@example.com'),
  SUPER_ADMIN_NAME: z.string().trim().min(1).default('Super Admin'),
  SUPER_ADMIN_PASSWORD: z.string().min(12).default('ChangeMeSuperAdmin123!'),
  JWT_SECRET: z.string().min(16).default('change-me-in-production-please'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  SALT_ROUNDS: z.coerce.number().int().positive().default(12)
});

export type Env = z.infer<typeof EnvSchema>;
export const env: Env = EnvSchema.parse(process.env);
