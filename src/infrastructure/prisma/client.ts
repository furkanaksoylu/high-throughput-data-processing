import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { pool } from "../database/pool";

const prismaAdapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter: prismaAdapter });
