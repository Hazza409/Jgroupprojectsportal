// ── Legal documents ──────────────────────────────────────────
// Terms of use, privacy policy and cookie notice, as STRUCTURE with drafting
// notes rather than finished wording.
//
// The wording is deliberately absent. This portal fronts multi-million-dollar
// construction contracts, and terms that interact with a building contract are
// a solicitor's work: clauses that merely sound right would give J Group
// documents nobody qualified has reviewed, which is worse than having none.
// Each section below therefore states WHAT IT MUST COVER and why it matters
// for this particular app, so the drafting is a filling-in exercise.
//
// HOW TO PUT THESE INTO FORCE
//   1. Replace each section's `body` with the settled wording.
//   2. Delete its `mustCover` notes (they only render while a doc is a draft).
//   3. Bump `version` — acceptances record the version they agreed to, so a
//      new version is a new agreement and previously recorded acceptances are
//      not silently carried over.
//   4. Set `inForce: true`. Until then the pages render marked as drafts and
//      nothing asks a client to accept them.

/**
 * The contracting entity. Named here once so the terms, the privacy policy and
 * anything else legal read from a single source — a portal that says "J Group
 * Projects" in one document and a different entity in another is an argument
 * waiting to happen about who the client actually contracted with.
 */
export const LEGAL_ENTITY = {
  name: "J Group Projects Pty Ltd",
  abn: "65 649 858 617",
} as const;

/** "J Group Projects Pty Ltd (ABN 65 649 858 617)" */
export function legalEntityLine(): string {
  return `${LEGAL_ENTITY.name} (ABN ${LEGAL_ENTITY.abn})`;
}

export type LegalDocSlug = "notice" | "terms" | "privacy" | "cookies";

export interface LegalSection {
  heading: string;
  /** Settled wording. Empty while the section is still a skeleton. */
  body?: string;
  /** What this clause has to do, and why it matters here. Drafting guidance. */
  mustCover?: string[];
}

export interface LegalDoc {
  slug: LegalDocSlug;
  title: string;
  /** One line under the title. */
  summary: string;
  /**
   * Bumped whenever the wording changes. Acceptance is recorded against a
   * version, so a change makes previous acceptances stale rather than
   * silently re-applying them to text nobody agreed to.
   */
  version: string;
  /**
   * False until a solicitor has settled the wording. While false the page
   * shows a draft notice, the drafting guidance is visible, and no client is
   * asked to accept anything — an acceptance recorded against placeholder text
   * would be a legal fiction, and worse than no record.
   */
  inForce: boolean;
  sections: LegalSection[];
}

// ── Interim portal notice ────────────────────────────────────
// Live wording, deliberately narrow in what it attempts.
//
// The clauses in a full terms of use that genuinely need a solicitor are the
// ones that CREATE or EXCLUDE rights: liability limits, indemnities, IP
// ownership. Wrong wording there actively harms J Group, which is why the
// terms remain a skeleton.
//
// Everything below only disclaims or states fact — that the building contract
// governs, that figures move, that decisions are recorded. None of it grants
// J Group anything or takes anything from the client, so it can stand without
// legal drafting and still do the most valuable job: making it explicit that
// a number on a dashboard is not a contractual commitment.
//
// It is a NOTICE, not an agreement. Nobody is asked to accept it, which keeps
// it clear of the acceptance machinery and of any argument about whether an
// interim document formed part of the contract.
const NOTICE: LegalDoc = {
  slug: "notice",
  title: "Portal Notice",
  summary: "How to read what this portal shows you, while the full terms of use are prepared.",
  version: "1.0",
  inForce: true,
  sections: [
    {
      heading: "What this portal is",
      body:
        "This portal is provided by J Group Projects Pty Ltd (ABN 65 649 858 617) so you can see how your " +
        "project is progressing — the budget, costs incurred, progress claims, variations, programme and " +
        "site information, in one place and kept current. It is a way of sharing information with you. It " +
        "is not the contract, and it is not a substitute for talking to us.",
    },
    {
      heading: "Your building contract governs",
      body:
        "Nothing shown in this portal varies, replaces or waives any term of your building contract. If " +
        "anything here differs from the contract, or from a notice or document formally issued under it, " +
        "the contract and that document prevail. Where your contract requires a notice to be given in a " +
        "particular way, this portal does not change that — showing something here is not the giving of a " +
        "contractual notice.",
    },
    {
      heading: "Figures change as the job runs",
      body:
        "The approved budget is the original estimate plus variations you have approved. A forecast is our " +
        "current expectation of a final cost, not an agreed change, and it can move. Spend to date reflects " +
        "costs recorded up to that moment and continues to change as invoices come in. Amounts include " +
        "builder's margin and GST, and can differ by a cent or two between screens through rounding.",
    },
    {
      heading: "The programme is indicative",
      body:
        "Dates in the schedule are our best current view and are subject to change — for reasons both " +
        "inside and outside our control, including weather, availability of trades and materials, " +
        "statutory approvals, variations, and decisions still to be made. Publishing or updating a " +
        "programme is not a commitment to any date shown.",
    },
    {
      heading: "What we record when you use it",
      body:
        "When you approve or decline something here, we record who did it, when, and exactly what was on " +
        "screen at the time. We also keep an internal log of which pages have been opened. This is so both " +
        "of us can establish later what was shown and what was decided; it protects you as much as it does " +
        "us. A full privacy policy is being prepared and will set this out properly.",
    },
    {
      heading: "Some records predate the portal",
      body:
        "Where a project was already under way before it was brought onto this portal, its earlier claims, " +
        "variations and approvals have been carried across from our records. Those entries say so on their " +
        "face, and show the date the decision was originally made rather than the date it was entered here.",
    },
    {
      heading: "If something looks wrong, tell us",
      body:
        "Please raise anything that looks incorrect or unclear with your J Group contact rather than " +
        "relying on it. We would far rather correct a figure than have you act on one that is wrong.",
    },
    {
      heading: "This is an interim notice",
      body:
        "A full terms of use and privacy policy are being prepared. This notice is provided in the " +
        "meantime so you know how to read what the portal shows. It is not an agreement, it does not ask " +
        "anything of you, and it does not limit anyone's rights or obligations under the building contract " +
        "or at law.",
    },
  ],
};

const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Use",
  summary: "The terms on which J Group Projects provides access to this portal.",
  version: "0.1-draft",
  inForce: false,
  sections: [
    {
      heading: "Who these terms are between, and how they are accepted",
      body:
        "This portal is provided by J Group Projects Pty Ltd (ABN 65 649 858 617), referred to below as " +
        "J Group. These terms govern your use of it.",
      mustCover: [
        "Say who the other party is: the client under the building contract, and any additional people they ask us to give access to (co-owners, architect, family office).",
        "State that using the portal, or clicking to accept, forms agreement to these terms.",
        "The portal records who accepted which version and when. Say that plainly — it is evidence, and it should not be a surprise.",
      ],
    },
    {
      heading: "These terms do not vary the building contract",
      mustCover: [
        "THE MOST IMPORTANT CLAUSE HERE. State that the portal is a means of sharing information and that nothing in it varies, replaces or waives any term of the building contract.",
        "Say which prevails if a figure or document in the portal conflicts with the contract or a formally issued notice — it must be the contract.",
        "Cover whether a contractual notice can be validly GIVEN through the portal, or whether notices must still follow the contract's notice provisions. Getting this wrong in either direction is the main litigation risk: a client could argue a dashboard figure bound J Group, or that a notice shown here satisfied a contractual requirement.",
      ],
    },
    {
      heading: "Approvals given through the portal",
      mustCover: [
        "Clients approve variations and progress claims in this portal, and each approval is recorded with a timestamp and a fingerprint of exactly what was on screen.",
        "State the legal effect of clicking approve: is it authorisation of the works and the associated cost adjustment under the contract, or an in-principle agreement pending a signed variation?",
        "This wording is already displayed to clients at the point of approval and stored on every approval record. It lives in AUTHORITY_STATEMENT in src/lib/audit.ts and is marked TODO(Andrew) — settle it here and there together, because they must say the same thing.",
        "Cover approvals recorded by J Group on the client's behalf when a decision was given outside the portal (by email or in a meeting), which the system supports and labels as such.",
      ],
    },
    {
      heading: "Status of the figures shown",
      mustCover: [
        "Distinguish the categories the portal actually displays: the approved budget (estimate plus approved variations), forecast adjustments (J Group's current expectation, not an agreed change), spend to date, and progress claims issued.",
        "State that a forecast is an estimate and does not commit either party.",
        "Cover figures carried in from before a job joined the portal — several jobs were onboarded with historical claims and approvals recorded retrospectively, and the records say so on their face.",
        "Address rounding: figures are grossed for margin and GST at display time and can differ by a cent or two between screens.",
      ],
    },
    {
      heading: "The construction programme is indicative",
      body:
        "The programme shown in this portal is J Group's best current view of how the build is expected " +
        "to run. It is indicative and subject to change. Dates move for reasons inside and outside our " +
        "control — weather, availability of trades and materials, statutory approvals, variations, and " +
        "decisions still to be made. Publishing a programme, or updating one, is not a commitment to any " +
        "date shown and does not vary any date agreed under the building contract.",
      mustCover: [
        "Confirm this against the building contract's own provisions on time: any contractual date for practical completion, and the extension-of-time machinery, live in the contract and must not be cut across by this clause.",
        "Decide whether a published programme can start time running for any contractual purpose (a delay notice, an EOT claim). It should not, unless the contract says so.",
      ],
    },
    {
      heading: "Accounts and access",
      mustCover: [
        "Each person gets their own login; credentials must not be shared.",
        "The client must tell J Group when someone should no longer have access.",
        "J Group may suspend or withdraw access, and when.",
        "Note honestly what account security exists today: password sign-in, sessions that persist for 30 days, and no multi-factor authentication.",
      ],
    },
    {
      heading: "Availability",
      mustCover: [
        "No promise of uninterrupted availability; the portal may be unavailable during deployment or maintenance.",
        "The portal is a convenience, not the contractual record of the project. J Group's own records prevail if the portal is unavailable or wrong.",
      ],
    },
    {
      heading: "Intellectual property and confidentiality",
      mustCover: [
        "Ownership of drawings, specifications, estimates and cost breakdowns published to the portal, and what the client may do with them.",
        "Confidentiality: pricing, supplier invoices and subcontractor rates are commercially sensitive.",
        "Ownership of the portal software and branding itself.",
      ],
    },
    {
      heading: "Liability",
      mustCover: [
        "Limitation of liability for reliance on portal information, subject to Australian Consumer Law, which cannot be excluded.",
        "Note that the Australian Consumer Law and the Home Building Act 1989 (NSW) both constrain what a builder can exclude for residential work — a limitation drafted too broadly may be unenforceable and can itself be a problem.",
      ],
    },
    {
      heading: "Changes to these terms",
      mustCover: [
        "How changes are notified and when they take effect.",
        "The portal versions these terms and records acceptance per version, so a material change should require fresh acceptance rather than passive notice.",
      ],
    },
    {
      heading: "Governing law",
      mustCover: [
        "Governing law and jurisdiction. The projects are in New South Wales.",
        "Any dispute-resolution step required before proceedings.",
      ],
    },
  ],
};

const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: "What personal information this portal holds, why, and what you can do about it.",
  version: "0.1-draft",
  inForce: false,
  sections: [
    {
      heading: "Who is responsible for your information",
      body:
        "J Group Projects Pty Ltd (ABN 65 649 858 617) is responsible for the personal information held " +
        "in this portal.",
      mustCover: [
        "A contact point for privacy enquiries — a monitored address, not a personal one.",
        "Whether J Group is an APP entity under the Privacy Act 1988 (Cth). Small businesses under $3m turnover can be exempt — but the exemption is narrow, and holding this volume of client financial information makes voluntarily complying the safer position.",
      ],
    },
    {
      heading: "What this portal collects",
      mustCover: [
        "Account details: name, email address, role, and a hashed password (passwords are never stored in readable form).",
        "Project information that identifies people: client names, contract sums, variation and claim histories, payment records, and uploaded documents.",
        "DISCLOSE THE VIEW LOG. The portal records which pages a client opens and when, so that 'I was never shown that variation' can be answered. It is internal and never shown to clients — but recording it without disclosing it is the problem, not the recording.",
        "Decision records: who approved or rejected what, when, and for how much. These are immutable by design.",
      ],
    },
    {
      heading: "Why we collect it",
      mustCover: [
        "Administering the building contract, issuing and evidencing progress claims and variations, and keeping a record of decisions.",
        "State that the evidentiary purpose is deliberate — the record exists to protect both parties — and that it is kept accordingly.",
      ],
    },
    {
      heading: "Who else can see it",
      mustCover: [
        "J Group staff.",
        "Other people the client has asked us to give access to on their own project. Access is scoped per project: a client sees only their own job.",
        "Service providers, which currently are: Render (application and database hosting), the email provider used for notifications, and Xero where cost data is synchronised.",
        "Confirm where each provider stores data and whether any of it leaves Australia — Render regions and the email provider need checking before this can be stated.",
      ],
    },
    {
      heading: "How long it is kept",
      mustCover: [
        "A retention period, informed by the limitation periods for building work in NSW — the Home Building Act statutory warranty periods are six years for major defects and two years otherwise, and records are worth keeping at least that long.",
        "Note that decision records are append-only and are not deleted or edited, only superseded. Say so, because it is a limit on any deletion request.",
      ],
    },
    {
      heading: "Access, correction and complaints",
      mustCover: [
        "How someone asks for a copy of their information or asks for a correction, and the response timeframe.",
        "That a correction to a decision record is made by adding a further record, never by altering the original.",
        "Complaints: to J Group first, then to the OAIC.",
      ],
    },
    {
      heading: "Security",
      mustCover: [
        "Describe the protections honestly: encrypted transport, hashed passwords, per-project access control, and security headers.",
        "Do not overstate. There is currently no multi-factor authentication, sessions last 30 days, and there has been no independent security assessment. A privacy policy that claims more protection than exists is its own liability.",
        "What happens on a data breach, and the Notifiable Data Breaches scheme.",
      ],
    },
  ],
};

const COOKIES: LegalDoc = {
  slug: "cookies",
  title: "Cookie Notice",
  summary: "What this portal stores on your device, and why there is no consent banner.",
  version: "0.1-draft",
  inForce: false,
  sections: [
    {
      heading: "What is stored",
      body:
        "Signing in sets a small number of cookies that keep you signed in and protect the sign-in form " +
        "against cross-site request forgery. Your light or dark theme choice is saved in your browser's " +
        "local storage so the portal looks the same next time you visit. That is everything this portal " +
        "stores on your device.",
      mustCover: [
        "Factually accurate as at this version: the only cookies are NextAuth's session token, CSRF token and callback URL, plus a theme preference in localStorage. Re-check if analytics, embedded media or a chat widget is ever added.",
      ],
    },
    {
      heading: "There is no tracking",
      body:
        "This portal contains no analytics, advertising or third-party tracking of any kind. Nothing you " +
        "do here is shared with an advertising network, and no cookie follows you to another website.",
    },
    {
      heading: "Why you are not asked to consent",
      body:
        "Consent is required for cookies that are not necessary to provide a service you asked for. The " +
        "cookies here are necessary: without them you cannot stay signed in. Asking you to agree to " +
        "something the portal cannot work without would imply a choice that does not exist, so we tell " +
        "you what is stored instead of asking permission for it.",
      mustCover: [
        "The factual description above is accurate. The LEGAL CONCLUSION that no consent is required should still be confirmed — it rests on the strictly-necessary exemption under the ePrivacy Directive and equivalent Australian guidance, and on there being no non-essential cookies, which is true today.",
      ],
    },
    {
      heading: "Clearing them",
      body:
        "You can clear cookies and site data at any time through your browser settings. Doing so signs " +
        "you out and resets your theme preference; it does not affect any project information, which is " +
        "stored on our servers rather than on your device.",
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDocSlug, LegalDoc> = {
  notice: NOTICE,
  terms: TERMS,
  privacy: PRIVACY,
  cookies: COOKIES,
};

export const LEGAL_ORDER: LegalDocSlug[] = ["notice", "terms", "privacy", "cookies"];

/** Whether a client should be asked to accept the terms at all. */
export function termsInForce(): boolean {
  return TERMS.inForce;
}

/** The version a client would be accepting right now. */
export function currentTermsVersion(): string {
  return TERMS.version;
}
