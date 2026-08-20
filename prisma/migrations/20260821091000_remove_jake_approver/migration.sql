-- Remove Jake as a forecast sign-off approver (Harry, 21 Aug 2026).
--
-- He was never configured in this codebase — the seeded approver was Nick, and
-- a prior migration already cleared him — but the list is editable in Company
-- settings, so this removes any jake@… entry that was typed in on the live
-- site. Surgical: it strips only that entry and leaves any other approver in
-- place, and NULLs the column when nothing remains (which puts the gate in its
-- unconfigured mode, where any staff sign-off publishes and the UI says so).
UPDATE "Company"
SET "forecastApprovers" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(coalesce("forecastApprovers", ''), '(^|,)\s*jake@[^,]*', '', 'gi'),
      '^\s*,\s*|,\s*,', ',', 'g'
    ),
    ' ,'
  ),
  ''
)
WHERE "forecastApprovers" ILIKE '%jake@%';
