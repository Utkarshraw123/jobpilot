# JobPilot

Multi-profile job search dashboard: paste any CV + answer a short template,
and the whole pipeline configures itself for that person — LinkedIn scans of
the last 7 days, fit scoring, one-page tailored CVs (Word + LaTeX, template
locked), ~150-word cover letters, an automatic CV Match Scorecard, public
hiring-contact lookup with an outreach draft, and a ⭐ dream-companies tab.

## How it works

1. **/setup** — paste the CV text, add extra confirmed context, lock official
   job titles/dates (never altered on CVs — background checks verify them),
   education, target searches, dream companies, and never-mention items.
   One AI call builds a "master profile" (single source of truth for every
   CV claim, with honesty guardrails baked in).
2. The dashboard stores profiles in the browser (no accounts, no database)
   and sends the active profile with every request. Multiple profiles —
   switch with the dropdown.
3. Everything else is identical per profile: scan (24h cooldown/profile),
   score, generate, contacts, statuses.

## Deploy (Vercel)

Root = this folder. Environment variables:

| Var | Required | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | yes | aistudio.google.com/apikey — free, no card |
| `GEMINI_API_KEY_2` | optional | second Google account — automatic failover when key 1 hits quota |
| `ANTHROPIC_API_KEY` | optional | console.anthropic.com — paid, best writing; last in the failover chain (set `FORCE_ANTHROPIC=1` to prefer it) |
| `APIFY_TOKEN` | yes | console.apify.com — free plan includes $5/month (~45 scans) |
| `DASHBOARD_PASSWORD` | yes | anything — the site asks once per browser |

## Local dev

```bash
npm install && npm run dev   # http://localhost:3200
```

## AI failover

Generation walks: Gemini key 1 (4 free models) → Gemini key 2 (4 free
models) → Anthropic. A hit quota moves silently to the next rung — no
interruption, cheapest first.
