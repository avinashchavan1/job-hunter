# Job Hunter — web version plan

Goal: replace the desktop app with a private website for you, Sweta and a few invited people.
Same screens (Today, Tracker, Profile, Settings), same job sources and AI tools, open from any phone or computer.

## Where things live

| Piece | Where | Cost |
|---|---|---|
| Website (React, the current screens reused) | Netlify (you're already signed in there) | free |
| Database, sign-in, file storage | Supabase project **avinash-all-aps**, in its own `jh` schema so it can't touch your other app's tables | free tier |
| Job checks, scoring, AI tools | Supabase Edge Functions (server code) | free tier |
| Daily check | Supabase scheduler (pg_cron) | free |
| API keys (AI, JSearch, Jooble, Adzuna, Google) | Supabase function secrets — never sent to the browser | — |

## Sign-in

- Email magic link (no passwords). Only emails on an allow-list can get in — you add them in Settings.
- Everyone on the list shares one workspace and sees all people (Sweta, you, …), like the desktop app today.

## What carries over

- People/profiles, resume upload and AI reading of the resume (PDF/Word)
- Job sources: JSearch, Jooble, Adzuna, Remotive, company career boards
- Scoring, Today screen, trust/scam check, Tracker board
- Cover note, tailored resume (opens as a print-ready page → Save as PDF), interview prep, saved answers
- Your existing data: Sweta's 123 jobs, scores, tracker and notes are copied up once
- Daily check at the set time

## What changes

- **Naukri and LinkedIn**: no browser reading. Jobs come in from their **job-alert emails** in Gmail
  (read-only Google connection). Works from the server and can't get anyone's account flagged.
- **Fill form**: dropped. Each job keeps "Saved answers" to copy-paste, plus the tailored resume download.
- **Notifications**: optional daily email "N new matches today" instead of desktop pop-ups.
- **AI**: the local FreeLLMAPI on this Mac can't be reached from the cloud. Needs an OpenRouter or Anthropic key.
- Free Supabase projects pause after a week of no use — the daily check keeps it awake.

## Build order (each step usable on its own)

1. Database tables + security rules, sign-in, empty site live on Netlify
2. People + resume upload and reading
3. Job checks (all APIs + career boards) and the daily schedule
4. Scoring, Today, trust check, Tracker
5. Cover note, tailored resume, interview prep, saved answers
6. Gmail job alerts (Naukri, LinkedIn)
7. Copy local data up; remove the Electron app and Windows/Mac installers

## What you do yourself (I never type keys or passwords)

- Paste API keys with commands I give you (`supabase secrets set …`)
- Add the website address to your Google OAuth client (for Gmail), when we reach step 6
- Click the sign-in link in your email
