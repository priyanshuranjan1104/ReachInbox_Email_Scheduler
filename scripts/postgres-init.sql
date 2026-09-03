-- PostgreSQL initialisation script
-- Runs automatically on first container start via docker-entrypoint-initdb.d/
-- This file should contain only one-time setup that Prisma migrations do NOT handle.

-- Enable the pgcrypto extension (used for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable the pg_trgm extension (used for trigram text search as a fallback)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- All table creation is handled by Prisma migrations (see backend/prisma/schema.prisma)
