-- Fortnightly house template (Jake §6): the structure is works completed,
-- upcoming, DECISIONS NEEDED, delays. The decisions section was missing.
ALTER TABLE "ProjectUpdate" ADD COLUMN IF NOT EXISTS "decisionsNeeded" TEXT;
