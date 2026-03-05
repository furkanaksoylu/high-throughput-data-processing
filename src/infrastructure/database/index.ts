import { ensureInitialSuperAdmin } from './bootstrap';
import { pool } from './pool';
import { logger } from '../observability/logger';

export { pool };

export async function initDb() {  
  await ensureInitialSuperAdmin();
  logger.info({ msg: 'db_initialized' });
}
