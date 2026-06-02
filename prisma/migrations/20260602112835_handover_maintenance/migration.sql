-- CreateEnum
CREATE TYPE "ProjectPhase" AS ENUM ('BUILD', 'HANDOVER', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('SITE_MEETING', 'MAINTENANCE', 'BOOKING');

-- CreateEnum
CREATE TYPE "HandoverDocKind" AS ENUM ('REGISTER', 'OM_MANUAL', 'WARRANTY', 'JGROUP');

-- CreateEnum
CREATE TYPE "ServiceBookingStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "kind" "CalendarEventKind" NOT NULL DEFAULT 'SITE_MEETING';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "phase" "ProjectPhase" NOT NULL DEFAULT 'BUILD';

-- CreateTable
CREATE TABLE "HandoverDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "HandoverDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "fileKey" TEXT,
    "originalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceScheduleItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBooking" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ServiceBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledAt" TIMESTAMP(3),
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "quoteAmountCents" INTEGER,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverDocument_projectId_idx" ON "HandoverDocument"("projectId");

-- CreateIndex
CREATE INDEX "HandoverDocument_projectId_kind_idx" ON "HandoverDocument"("projectId", "kind");

-- CreateIndex
CREATE INDEX "Warranty_projectId_idx" ON "Warranty"("projectId");

-- CreateIndex
CREATE INDEX "MaintenanceScheduleItem_projectId_idx" ON "MaintenanceScheduleItem"("projectId");

-- CreateIndex
CREATE INDEX "ServiceBooking_projectId_idx" ON "ServiceBooking"("projectId");

-- CreateIndex
CREATE INDEX "QuoteRequest_projectId_idx" ON "QuoteRequest"("projectId");

-- AddForeignKey
ALTER TABLE "HandoverDocument" ADD CONSTRAINT "HandoverDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceScheduleItem" ADD CONSTRAINT "MaintenanceScheduleItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
