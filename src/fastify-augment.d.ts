import "fastify";
import type { AuthUser } from "./domain/auth/types";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
