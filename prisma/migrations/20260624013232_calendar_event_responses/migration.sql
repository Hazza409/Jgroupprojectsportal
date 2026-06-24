-- CreateTable
CREATE TABLE "CalendarEventResponse" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEventResponse_eventId_idx" ON "CalendarEventResponse"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventResponse_eventId_userId_key" ON "CalendarEventResponse"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "CalendarEventResponse" ADD CONSTRAINT "CalendarEventResponse_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventResponse" ADD CONSTRAINT "CalendarEventResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
