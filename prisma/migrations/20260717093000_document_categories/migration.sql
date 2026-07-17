-- Broaden the documents vault: add general document categories alongside the
-- design ones. Idempotent (ADD VALUE IF NOT EXISTS).
ALTER TYPE "DesignDocKind" ADD VALUE IF NOT EXISTS 'CONTRACT';
ALTER TYPE "DesignDocKind" ADD VALUE IF NOT EXISTS 'INSURANCE';
ALTER TYPE "DesignDocKind" ADD VALUE IF NOT EXISTS 'WARRANTY';
ALTER TYPE "DesignDocKind" ADD VALUE IF NOT EXISTS 'COMPLIANCE';
ALTER TYPE "DesignDocKind" ADD VALUE IF NOT EXISTS 'PERMIT';
