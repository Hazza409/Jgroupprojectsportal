-- CreateEnum
CREATE TYPE "ProjectClientView" AS ENUM ('CONSTRUCTION', 'HANDOVER');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "clientView" "ProjectClientView" NOT NULL DEFAULT 'CONSTRUCTION';
