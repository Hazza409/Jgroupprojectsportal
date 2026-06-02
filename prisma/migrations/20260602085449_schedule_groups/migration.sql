-- AlterTable
ALTER TABLE "ScheduleItem" ADD COLUMN     "durationDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "group" TEXT;
