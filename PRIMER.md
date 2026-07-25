# Yellow — Project Primer

An AI-powered network for entrepreneurs, builders, and independents. Yellow matches
people on **soft skills, interests, and passions** — deliberately *not* on résumés,
schools, or job titles.

The pitch: you go to events, collect contacts, and nothing happens. LinkedIn reduces
you to a job title; Instagram to an aesthetic. People arrive guarded and the real
collaborations never form. Yellow's answer is a network built on overlap, plus a
mutual-vulnerability gate that makes both sides show up before anyone can DM.

Named for the colour psychology: openness, warmth, growth.

---

## The core loop

1. **Onboarding** — you write a free-text blurb about yourself. Claude (via Bedrock)
   extracts your soft skills and interests as tags. You confirm and edit them.
2. **Bubble map** — an Apple-Watch-style floating cluster. You sit at the centre;
   everyone else orbits, **sized and positioned by how much you overlap**. Bigger and
   closer means more shared. Drag to pan, scroll to zoom.
3. **Match nudge** — a banner surfaces your strongest match: *"you and Maya overlap on
   14 skills & interests."*
4. **Intro exchange** — the gate. Both people answer *Who are you? / What are you
   building? / What are you looking for?* by voice. **Neither can DM until both have
   sent.** A split-node rail visualises the rule as you satisfy it.
5. **DM unlocks** — 1:1 chat opens.
6. **Project hubs** — per-project rosters. Entrepreneurs juggle several ventures; you
   don't need everyone on everything.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16.2.11** (App Router, Turbopack default) |
| UI | React 19.2.4, **Tailwind v4** (CSS-first), Geist Sans/Mono |
| Auth | **Amazon Cognito** — email + password, custom UI, server-side |
| Data | **DynamoDB** — `yellow-app` (per-user state), `yellow-users` (directory) |
| Files | **S3** — `yellow-voice-563923432327` (voice notes, presigned URLs) |
| AI | **Amazon Bedrock** — Claude Haiku 4.5 for tag extraction |
| Hosting | **AWS Amplify** (SSR / WEB_COMPUTE) |

Region **us-east-2**, account **563923432327**. No client-side AWS SDK: everything
goes through Next.js API routes so credentials stay server-side.

---

## ⚠️ This is NOT the Next.js in your training data

Verified against `node_modules/next/dist/docs/`. Getting these wrong is the most
common source of wasted time here:

- **Turbopack is the default** for `dev` and `build`. Never add `--turbopack`.
- **`params` / `searchParams` are Promises.** Client pages read them with React's
  `use()`: `const { id } = use(params)`.
- **`middleware.ts` no longer exists** — it's **`proxy.ts`** with a named `proxy`
  export. Node runtime only.
- **`cookies()` from `next/headers` is async** — `await cookies()`.
- **Tailwind v4 is CSS-first.** There is **no `tailwind.config.js`**. Tokens live in
  `app/globals.css` under `@theme inline`. Prefer arbitrary values (`bg-[#0B0A08]`).
- **`next lint` is gone**; `next build` no longer lints — but it **still typechecks**
  and still fails on type errors.
- Never hand-write `<head>`/`<title>` — use `export const metadata` / `viewport`.
- `@/*` → repo root. `app/` at root, no `src/`.

---

## Architecture

### Data model (`lib/types.ts` — the frozen contract)

`Profile` · `SeedPersona` (adds `intro` + `cannedReplies`) · `Connection`
(`stranger → nudged → intro_pending → connected`) · `Message` · `Hub` · `AppState`
· `MatchResult`.

### The pair record (`lib/pair.ts` · `lib/pairServer.ts`)

Everything else in Yellow is per-user state keyed by one Cognito `sub`. A connection
belongs to *both* accounts, so it gets its own row in the same `yellow-app` table under
a deterministic key **`pair#<a>#<b>`** — the two member ids sorted lexicographically, so
either side computes the same string without knowing who wrote the row first.

The row holds `introA` / `introB` (each side's sent flag), `connectedAt`, and an
append-only `messages` list. Rules that must survive any edit:

- **`connectedAt` is server-authoritative.** The client never decides it is connected.
  `POST /api/pair/intro` stamps it only when both intro flags are set, guarded by
  `attribute_not_exists(connectedAt)` so a race can't stamp twice. The old local-only
  "they answered instantly" fiction is gone, along with the canned DM replies.
- **Messages append with `list_append`**, never read-modify-write — two people sending
  inside one round trip would otherwise lose a message.
- **`ensurePair` is an idempotent `UpdateCommand`** with `if_not_exists`, never a
  `PutCommand`, which would wipe an existing thread.
- The stored message carries `senderId`, not `from: 'me' | 'them'`. Each viewer maps it
  through `toViewerMessage`, which is what keeps `Message` in `lib/types.ts` frozen.
- Pair data lives in plain `useState` beside `people` — **outside** the persisted blob,
  so it can never reach localStorage or the state row.

Voice intros are recorded once and stored as `voiceIntro` on the user's `yellow-users`
directory row; the audio itself sits in S3 under `audio/<ownerId>/<messageId>.webm` and
is presigned at read time, never stored as a URL.

### Matching (`lib/match.ts`)

Pure and deterministic — the bubble layout depends on stability.

```
score = sharedSoftSkills × 2 + sharedInterests
```

Soft skills are weighted double **on purpose**: they're the product's whole
differentiator against résumé-based networking.

`rankMatches()` returns results sorted by score with a min-max `normalized` value in
`[0,1]` that drives bubble size and orbit radius.

### The tag vocabulary (`lib/seed.ts`)

`TAG_VOCAB` holds ~46 canonical tags. **Both** the Bedrock extractor and the offline
keyword fallback map onto this same vocabulary — that alignment is what guarantees a
new user actually overlaps with anyone. It is load-bearing, not cosmetic.

### State (`lib/store.tsx`)

Context + `useReducer`. Non-obvious invariants that must survive any edit:

- **`hydrated` always ends `true`** via three independent paths (local hydrate, cloud
  `finally`, and a 3.5s safety timeout). Break this and the app hangs on a spinner.
- **`revision` dirty-counter** gates persistence, so a *failed* hydration can never
  overwrite good cloud state with empty state.
- **`savedAt` last-write-wins** reconciles localStorage against DynamoDB.
- Directory `people` live **outside** the persisted blob — never write them to
  localStorage or the state row.
- State is keyed by the **Cognito `sub`**, resolved *before* the first state read.

### Fail-soft everywhere

Every remote dependency degrades instead of breaking:

| Dependency | Fallback |
|---|---|
| Bedrock | local keyword extraction (`lib/localExtract.ts`), identical UX |
| DynamoDB directory | empty list + intentional empty state |
| S3 upload | in-memory object URL; the connection still completes |
| Microphone denied | typed-text intro |
| Cognito unconfigured | auth wall **fails open** (see below) |
| `GET /api/pairs` | `{ ok: false }` — the store refuses to reconcile, so a transient failure can't delete real connections |
| `GET /api/pair` | `{ pair: null }`, identical to "not a member"; the screen keeps its last poll |
| `POST /api/pair/intro` | `connected: false` — the connect screen stays in "waiting" and the next poll picks up the truth |
| `POST /api/pair/message` | quiet "not sent" marker on that bubble, never an error screen |
| `GET /api/intro` | `{ intro: null }` — the connect screen says honestly that they haven't recorded yet |
| Presigned playback (`GET /api/audio?key=`) | `{ ok: false }` at 200; the waveform still renders, playback is just silent |

**The auth wall deliberately fails open** when `COGNITO_USER_POOL_ID` is absent.
Locking an app that has no working auth would brick it with no way in. This is why a
misconfigured deploy silently has *no* login wall rather than an error.

---

## AWS gotchas we actually hit

Each of these cost real time. They are not hypothetical.

1. **Bedrock needs an inference profile.** `anthropic.claude-haiku-4-5-...` fails with
   *"on-demand throughput isn't supported"*. Use **`us.anthropic.claude-haiku-4-5-20251001-v1:0`**.
   IAM must allow Bedrock across regions — profiles route through `us.*`/`global.*`.
2. **Cognito sign-in identifiers are immutable.** A pool created with email as an
   *alias* rejects email-format usernames outright, and you cannot change it — only
   recreate the pool.
3. **Amplify rejects any env var starting with `AWS`.** Correct behaviour: credentials
   come from the SSR compute role, not env vars. It also means `AWS_REGION` can't be
   set, so **the app must be deployed in us-east-2** to match the code's fallback.
4. **`amplify.yml` must forward `COGNITO_` to the runtime.** Console env vars reach the
   *build*, not the SSR runtime; the build spec greps them into `.env.production`.
   Omit the prefix and the login wall silently vanishes in production.
5. **Amplify has two IAM roles.** The **SSR Compute role** is the runtime identity —
   not the service role. Wrong one = pages render fine while every API route 500s.
6. **Amplify artifact dir must be `.next`**, not `out`. `out` silently ships a static
   site and every API route 404s.

---

## Layout

`components/PhoneFrame.tsx` is the app shell and owns the scroll container:

- **Desktop (≥768px):** 236px sidebar (brand, nav, account + sign-out) + main area.
- **Mobile:** bottom tab bar plus a sign-out strip.
- **`/home` is full-bleed** so the bubble field fills the canvas; every other screen
  sits in a `max-w-[560px]` reading column with `px-5 md:px-8`.
- **Chromeless routes** (no nav): `/`, `/onboarding`, `/reset`, `/login`, `/signup`.

If you change the frame's gutter, `app/connect/[id]/page.tsx` has a sticky footer with
a matching negative-margin bleed that must be updated too.

Components ship their own CSS via React 19's `<style href precedence="high">` pattern
(deduped by href) rather than touching `globals.css`.

---

## Local development

```bash
npm install
npm run dev          # Turbopack, no flags
node scripts/provision.mjs   # one-shot: creates the table + bucket + CORS
```

`.env.local` (gitignored) needs: `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `YELLOW_TABLE`, `YELLOW_USERS_TABLE`, `YELLOW_BUCKET`,
`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`,
`NEXT_PUBLIC_AUTH_REQUIRED`, `NEXT_PUBLIC_DEMO_PERSONAS`.

**Escape hatches:**
- `/reset` — clears local + cloud state and returns to onboarding.
- `NEXT_PUBLIC_DEMO_PERSONAS=true` — folds the 10 bundled personas back in when the
  room is empty. Requires a dev-server restart.
- `NEXT_PUBLIC_AUTH_REQUIRED=false` — drops the login wall.

See `DEPLOY.md` for Amplify, and `ROADMAP.md` for current status and next steps.
