import { PrismaClient } from "@prisma/client";

// Evita esgotar conexões em dev (hot reload cria um client novo a cada save)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
