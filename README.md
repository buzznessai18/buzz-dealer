# GrowthPilot AI

GrowthPilot is an internal business-development workspace for a software studio. It stores companies and leads, matches them to the studio’s catalog, prepares outreach for approval, and reports pipeline activity from the database.

## Stack

- Next.js App Router, React, TypeScript, Tailwind CSS
- Supabase Auth, Postgres, Storage, and Row Level Security
- OpenAI as the primary model, with Anthropic and Gemini behind the same server-side interface
- Optional Google Search, Google Places, Hunter.io, Apollo.io, Gmail, and Resend adapters

## Setup

1. Create a Supabase project.
2. Run `supabase/migrations/20261107120000_init.sql` in the SQL editor.
3. Copy `.env.example` to `.env.local` and fill in the values you have.
4. Install and start the app:

```bash
npm install
npm run dev
```

5. Create an account, create a workspace, and finish onboarding.

The app redirects to `/setup` when the Supabase URL or anon key is missing. It does not invent metrics. Empty workspaces show zeros and empty states.

## What works without extra vendor keys

- Authentication, workspaces, onboarding, and settings
- Product and service catalog
- Manual lead updates, notes, tasks, and the pipeline
- CSV lead import and deduplication
- Deterministic lead scoring and catalog matching
- Template-based outreach, marketing, and proposal drafts
- Campaign approval, sequences, suppression, and unsubscribe links
- Analytics and CSV export from stored records
- Workflow definitions and execution logs

AI text, live company search, business-email lookup, and email delivery run only after the matching credentials are saved. The screen says when a provider is not configured.

## Credentials

| Capability | Required values |
| --- | --- |
| App data and login | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Integration secrets and jobs | `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `CRON_SECRET` |
| AI research, drafts, assistant | `OPENAI_API_KEY` or an Anthropic/Gemini key selected in Settings |
| Company search | `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CX`, and/or `GOOGLE_MAPS_API_KEY`, and/or `APOLLO_API_KEY` |
| Business email lookup | `HUNTER_API_KEY` |
| Send mail | `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, or Gmail OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) |
| Delivery events | `RESEND_WEBHOOK_SECRET` on `POST /api/webhooks/resend` |
| Scheduled drafts and workflows | `POST /api/jobs/sequences` with `Authorization: Bearer $CRON_SECRET` |

LinkedIn and Stripe are shown as unavailable. This version does not call them.

## Compliance

Sending requires a recorded lawful basis, workspace acknowledgements for DPDP, GDPR, CAN-SPAM, and TRAI, an approved draft, a connected mailbox, and the suppression checks. Public contact data is not treated as permission to email. Sequences create drafts; they do not send mail unless a campaign explicitly allows automation and every check passes.

## Checks

```bash
npm run typecheck
npm run lint
npm run test:core
```
