-- Fortnightly forecast sign-off sits with Nick. Set only where it hasn't been
-- configured yet, so a later change made in Company settings is never clobbered
-- if this migration is re-run.
UPDATE "Company"
SET "forecastApprovers" = 'nick@jgroupprojects.com'
WHERE "forecastApprovers" IS NULL OR btrim("forecastApprovers") = '';
