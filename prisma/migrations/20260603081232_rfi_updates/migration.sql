-- CreateEnum
CREATE TYPE "RfiStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "RfiStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "dueDate" TIMESTAMP(3),
    "raisedById" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdatePhoto" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdatePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rfi_projectId_idx" ON "Rfi"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_projectId_number_key" ON "Rfi"("projectId", "number");

-- CreateIndex
CREATE INDEX "ProjectUpdate_projectId_idx" ON "ProjectUpdate"("projectId");

-- CreateIndex
CREATE INDEX "UpdatePhoto_updateId_idx" ON "UpdatePhoto"("updateId");

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdatePhoto" ADD CONSTRAINT "UpdatePhoto_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "ProjectUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
