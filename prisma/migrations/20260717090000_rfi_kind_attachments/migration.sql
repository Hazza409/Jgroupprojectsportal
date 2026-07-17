-- Q&A: add a Question/Decision kind + decision fields, and an attachments table.

-- Enum (guarded so re-run is safe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RfiKind') THEN
    CREATE TYPE "RfiKind" AS ENUM ('QUESTION', 'DECISION');
  END IF;
END $$;

ALTER TABLE "Rfi" ADD COLUMN IF NOT EXISTS "kind" "RfiKind" NOT NULL DEFAULT 'QUESTION';
ALTER TABLE "Rfi" ADD COLUMN IF NOT EXISTS "optionsProvided" TEXT;
ALTER TABLE "Rfi" ADD COLUMN IF NOT EXISTS "impactIfLate" TEXT;

CREATE TABLE IF NOT EXISTS "RfiAttachment" (
  "id"           TEXT NOT NULL,
  "rfiId"        TEXT NOT NULL,
  "fileKey"      TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "contentType"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RfiAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RfiAttachment_rfiId_idx" ON "RfiAttachment"("rfiId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RfiAttachment_rfiId_fkey') THEN
    ALTER TABLE "RfiAttachment"
      ADD CONSTRAINT "RfiAttachment_rfiId_fkey"
      FOREIGN KEY ("rfiId") REFERENCES "Rfi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
