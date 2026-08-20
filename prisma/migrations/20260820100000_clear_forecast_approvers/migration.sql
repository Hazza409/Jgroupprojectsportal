-- Remove the required-approver gate on forecasts (Harry, 20 Aug 2026).
--
-- nick@jgroupprojects.com was configured as the sole approver but no staff
-- account was ever created for him, so nothing could publish — the gate was
-- deadlocked, not enforcing anything. Clearing the list switches the gate to
-- its unconfigured mode: any staff member's single sign-off publishes, the
-- Settings page states loudly that the two-person control is NOT being
-- enforced, and every sign-off is still recorded with name and time.
--
-- Only removes Nick's seeded value, so a different approver list typed into
-- Company settings later is never clobbered if this re-runs.
UPDATE "Company"
SET "forecastApprovers" = NULL
WHERE btrim(coalesce("forecastApprovers", '')) = 'nick@jgroupprojects.com';
