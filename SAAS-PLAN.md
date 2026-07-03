# SaaS Plan — turning the J Group dashboard into a multi-builder product

Goal: other builders subscribe and run their own branded portal on ONE shared
platform, with their data completely walled off from every other builder.
J Group becomes "customer #1" of its own product.

**Working method:** built in milestones, each one deployable and tested before
the next starts. No long-lived side branches — every milestone keeps the live
J Group site working (J Group is simply the first company in the system).
One milestone ≈ one working session. Start a session with:
*"Continue the SaaS plan — milestone N"* and Claude picks up from this file.

---

## Milestone 1 — White-label (1 session) ✅ DONE 2026-07-04
Unscrew the J Group branding from the walls.
- New `Company` model + settings page: name, logo upload, tagline, brand
  colours, builder's margin %, GST %.
- Every hardcoded "J Group Projects" / "One Of One" / 12.5% / logo reference
  reads from company settings instead. Font falls back to a licensed-for-
  everyone default (Ginto Nord stays for J Group only).
- J Group seeded as the first company; live site looks identical after deploy.
- **Useful even if the SaaS never happens** (also the Path-A per-builder-copy
  foundation).

## Milestone 2 — Tenancy walls (2–3 sessions) ← the security core
The critical one. Slow and careful, heavily reviewed.
- `companyId` on projects; users belong to a company (membership + role).
- Rewrite `src/lib/scope.ts`: "BUILDER sees all projects" becomes "BUILDER
  sees own company's projects". Every page/action/API re-checked.
- Builder dashboard, team page, notifications (`notifyBuilders` → company's
  builders), templates, uploads — all company-scoped.
- Safe migration: all existing rows assigned to the J Group company.
- Exit test: two seeded companies; prove NO route/action/file URL leaks
  across the wall (adversarial multi-agent audit).

## Milestone 3 — Onboarding (1–2 sessions)
Strangers must be able to join without Claude/Harry doing it by hand.
- Public sign-up: create company + first admin account.
- Staff invites by email; **password reset flow** (doesn't exist today —
  mandatory before real customers).
- Email verification. ⚠️ Prerequisite: platform email sending must be live
  (Resend on the product's own domain is the clean choice here — the tabled
  Gmail setup is J-Group-specific and won't fit a multi-tenant platform).

## Milestone 4 — Billing (1–2 sessions)
- Stripe subscriptions: plan(s), 14/30-day free trial, card capture,
  billing portal, "subscription lapsed" read-only lockout, webhooks.
- Needs: Stripe account (Harry sets up), pricing decision.

## Milestone 5 — Scale plumbing (1 session)
- File storage moves local-disk → S3-compatible cloud (Cloudflare R2) with
  per-company key prefixes (per-customer disks don't scale).
- Platform-owner admin view for Harry: companies, usage, disable/enable.
- Render: upgrade DB off the free plan (expires ~21 Sept 2026 regardless),
  automated backups, error alerting.

## Milestone 6 — Hardening + beta (1–2 sessions)
- Full adversarial security audit (cross-tenant, auth, uploads, rate limits).
- Fix everything found; re-audit.
- Onboard 1–2 friendly builders as beta customers at a discount; watch for a
  fortnight; fix what they trip over.

**Total: ~8–12 sessions, realistically 3–5 weeks calendar.**

---

## Harry's parallel to-do list (non-code, can start now)
1. **Product name + domain** — it can't ship as "J Group Projects" to other
   builders. Buy a domain for the product (also used for platform email).
2. **Pricing** — e.g. per-builder-company monthly fee; decide trial length.
3. **Pilot builders** — 1–2 friendly builders willing to beta test.
4. **Stripe account** — stripe.com, business details, bank account (M4).
5. **Terms of Service + Privacy Policy** — template service or lawyer;
   required before strangers put client financial data in.
6. **Support** — an email address for customer problems + who answers it.
7. **Font** — Ginto Nord licence doesn't extend to customers; product default
   will be an open font (Claude will propose options in M1).

## Decisions already made
- Shared platform (Path B) built incrementally, J Group = tenant #1.
- Each milestone ships (deployed + verified) before the next starts.
- Money movement stays manual (no auto Xero push) — unchanged.

## Status log
- 2026-07-02: Plan written. Nothing started.
- 2026-07-04: **M1 (white-label) complete.** `Company` model added (name, short
  name, tagline, location, print footer, logo upload, per-theme accent colours,
  margin %, GST %); J Group seeded by the migration itself so prod self-seeds on
  deploy and looks identical. Every hardcoded "J Group" / "One Of One" / 12.5% /
  10% reference (pages, nav, emails, claim print, manifest, metadata) now reads
  from settings via `src/lib/company.ts`. New builder-only page:
  **/builder/settings**. Margin/GST constants removed from `money.ts` —
  `inclMarginGst(cents, company)` everywhere. Logo uploads live under public
  `company/` storage keys. Font: Ginto stays for J Group; stack already falls
  back to Helvetica/Arial (per-tenant font choice deferred to M2/M3).
  Verified: build + typecheck clean, browser smoke test (identical rendering,
  settings round-trip, accent + margin flow-through). Next: **Milestone 2**.
