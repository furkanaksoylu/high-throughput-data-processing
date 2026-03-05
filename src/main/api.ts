import { createApp } from "../interfaces/http/app";
import { initDb } from "../infrastructure/database";
import { env } from "../infrastructure/config/env";
import { logger } from "../infrastructure/observability/logger";
import { toErrorMessage } from "../shared/utils/errorMessage";

async function main() {
  await initDb();
  const app = await createApp();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ msg: "api_started", port: env.PORT });
}

main().catch((error) => {
  logger.error({ msg: "fatal", err: toErrorMessage(error, "unknown fatal error") });
  process.exit(1);
});
