# Yellow — 10-Hour Roadmap

Status of the hackathon build, what shipped, and what's next in priority order.
See `PRIMER.md` for architecture and `DEPLOY.md` for deployment mechanics.

**Live:** https://main.d107b9gzaimhij.amplifyapp.com

---

## Shipped ✅

### Hours 0–1 · Foundation
- Next.js 16 scaffold read against `node_modules/next/dist/docs/` before any code —
  Turbopack default, Promise `params`, `proxy.ts`, Tailwind v4 CSS-first.
- `lib/types.ts` frozen as the shared contract so parallel work couldn't diverge.
- Yellow theme tokens; `PhoneFrame` + `TabBar` shell.
- DynamoDB `yellow-app` created; `scripts/provision.mjs` written (idempotent).

### Hours 1–3 · Data layer + the signature screen
- `TAG_VOCAB` (~46 canonical tags) + 10 seeded personas with scripted intros.
- `lib/match.ts` — pure scoring, soft skills weighted 2×, min-max normalised.
- `lib/localExtract.ts` — offline keyword extractor onto the same vocabulary.
- **Bubble map**: golden-angle placement, 30-iteration relaxation for a
  collision-free cluster, then a `requestAnimationFrame` sim writing transforms
  straight to the DOM (React never re-renders per frame). Drag-to-pan, clamped zoom,
  `prefers-reduced-motion` fallback.
- `ProfileCard` bottom sheet + `MatchNudge`.

### Hours 3–5 · The full narrative
- **Onboarding** — three steps (Write → Read → Confirm) with a beam sweeping between
  the lines of your own words during extraction; `TagEditor` snaps free text to
  canonical vocab casing.
- **Bedrock extraction** live via `us.anthropic.claude-haiku-4-5-20251001-v1:0` using
  structured outputs, with silent fallback to local extraction.
- **Voice intro exchange** — real `MediaRecorder` capture, analyser-driven waveform,
  split-node rail that lights up as each side answers, typed fallback if the mic is
  denied, celebration on unlock.
- **DM thread** with day dividers and message grouping; **project hubs**
  (create, add/remove members, connected-only picker).
- **`/chats`** conversation list (fixed a dead-end where the tab pointed at `/home`).

### Hours 5–7 · Real AWS, real users
- **Desktop layout** — sidebar nav, full-bleed bubble canvas, reading column.
- **S3 voice storage** — bucket + CORS, presigned PUT/GET round-trip verified.
- **Live user directory** — `yellow-users` table, `/api/people`, mock data off by
  default behind `NEXT_PUBLIC_DEMO_PERSONAS`.
- **Cognito auth** — custom signup/login pages, httpOnly session cookies, five API
  routes, `proxy.ts` enforcing the wall.
- **Per-user state keyed by Cognito `sub`** — fixed a bug where every account shared
  one DynamoDB row and clobbered each other's messages.
- Sign-out in the sidebar (and a mobile strip) — previously there was **no way out**
  of the app once signed in.

### Hours 7–8 · Deploy
- `amplify.yml` + `DEPLOY.md`; fixed the build spec to forward `COGNITO_` to the SSR
  runtime (without it the deployed app had no login wall at all).
- Created `YellowAppAccess` policy + `YellowAmplifySSRComputeRole` and attached it —
  the compute role was `null`, so every API route had no AWS identity.
- Verified end-to-end **on the deployed URL**: signup, login, session, `/api/people`
  returning `source: "dynamodb"`.

### Hours 8–10 · Real connections
- **Shared pair rows** in `yellow-app` under `pair#<a>#<b>` — both intro flags,
  `connectedAt`, and an append-only message list written with `list_append`. A
  connection is now the server's fact rather than one browser's optimism, and the
  celebration only fires when both people have genuinely sent.
- **Real voice intros.** `toPerson()` no longer fabricates `intro.who` / `.building` /
  `.lookingFor` from a tagline. An intro is recorded once, stored on the user's
  `yellow-users` row, and replayed to whoever connects; someone who hasn't recorded
  gets an honest empty state instead of invented answers.
- **Voice notes survive a reload and cross accounts** — owner-scoped S3 keys
  (`audio/<ownerId>/<messageId>.webm`) plus a presigned `GET /api/audio?key=`, cached
  by message id.
- **Canned replies deleted.** The thread is polled from the shared row, so nothing in
  the app talks back to you any more.
- **In-app notifications** — a toast on connect and on a new message, an unread dot on
  the Chats tab and sidebar item, and per-thread unread counts in `/chats`.

### Hours 10–12 · Shared hubs, settings, photos
- **Hubs became real shared objects.** They lived in each user's private state blob,
  so adding someone wrote only to the adder's row and the invitee saw nothing —
  which is also why a hub felt pointless. Now `yellow-hubs` + `yellow-hub-items`,
  keyed off the session's Cognito `sub`. Verified with two real accounts: A creates,
  A adds B, **B sees it**, B posts, A sees the post.
- **A hub is now a workspace, not a roster** — an updates/questions feed and a task
  board with assignees, due dates and overdue highlighting. The list shows live
  signal ("3 open tasks · 1 overdue · last update 2h ago"), and each hub surfaces the
  members' combined tag coverage so it reads as a team assembled around a project.
- **Invite control inside the hub**, next to "just you so far" — the moment someone
  actually wants to fix an empty hub. Owner-only, offers only connected people, and
  all three empty cases speak.
- **Settings** (`/settings`) — name, emoji, tagline and tags all editable for the
  first time, plus the only route to record a voice intro outside a connection flow.
  The not-yet-recorded state leads the page, because without one nobody can connect
  with you at all.
- **Profile photos** — public-read `photos/*` carve-out on the S3 bucket so avatars
  load as plain `<img>` with no per-viewer presign; every other prefix stays private.
- Fixed a dead end: the empty-state "Edit your tags" button pointed at `/onboarding`,
  which bounces anyone with a profile straight back to `/home`. It did nothing.

---

## Next up 🎯

### P0 — Before demoing
- [ ] **Register 2–3 real accounts on the live URL.** The directory is empty; the
      first user sees "You're the first one here." The bubble map needs a crowd for
      "sized by overlap" to read at all. If the room is empty at demo time, set
      `NEXT_PUBLIC_DEMO_PERSONAS=true` and rebuild.
- [ ] **Walk the full flow on the deployed site**: signup → email code → onboarding →
      bubble map → nudge → voice intro → celebration → DM → hub.
- [ ] **Pre-grant microphone permission** in the demo browser so no OS prompt appears
      on stage.
- [ ] Confirm email delivery timing — Cognito's default sender is capped ~50/day and
      can land in spam. If judges sign up live, this is the riskiest dependency.

### P1 — Known issues
- [ ] **Same-browser account switching** briefly shows the previous user's profile
      (localStorage wins on `savedAt` before cloud reconciles). Fine across devices;
      avoid demoing two accounts in one window.
- [ ] **16 lint problems** (10 errors, 6 warnings) — `react-hooks/refs` writes during
      render in `BubbleField`, `MatchNudge`, `ProfileCard`, plus a few in `settings`
      and `onboarding`. Cosmetic: `tsc` is clean and `next build` passes (Next 16 no
      longer lints during build). The ref writes belong in effects.
- [ ] **Console noise on `/login` and `/signup`**: the store fires `/api/state` and
      `/api/people` while signed out and the wall correctly 401s them. Harmless, but
      visible with devtools open. Skip those fetches on public routes.
- [ ] **Orphaned `me` row** in `yellow-app` from the pre-auth era. Safe to delete.
- [ ] **`/api/pairs` is a `Scan`** with `begins_with(userId, 'pair#')`, filtered in the
      handler to rows containing my id. Fine at demo scale and it matches how
      `/api/people` reads the directory, but it reads every pair row on every 8s poll
      for every open tab. Needs a GSI (`a` and `b` as keys, or a per-member index)
      before real volume.

### P2 — Product gaps
- [ ] **Presigned playback URLs are cached in-session and expire after an hour**; a tab
      left open longer than that serves a dead URL until reload. Cache the expiry
      alongside the URL and re-presign on miss.
- [ ] Hub items have no edit-in-place for posts and no comment threads on a task —
      the feed is append-and-delete. Fine for a demo; thin for real use.
- [ ] `GET /api/hubs` is a `Scan` with `contains(memberIds, :me)`. Correct but reads
      every hub row per poll; needs a GSI (member → hubs) before real volume.
- [ ] Hub activity raises no notification. A task assigned to you or a question aimed
      at you should surface the same way a new message does.
- [ ] Match nudges are computed client-side on load. Real notifications need a
      server-side job.

### P3 — Hardening
- [ ] **Verify JWTs against the pool's JWKS** in `proxy.ts`. It currently checks
      presence and expiry only, relying on the httpOnly cookie.
- [ ] Rotate the AWS access key and Cognito client secret (both passed through a
      chat transcript).
- [ ] Detach `IAMFullAccess` and `AdministratorAccess-Amplify` from the `Yellow` IAM
      user — granted only to automate the deploy.
- [ ] Move Cognito email to SES for volume beyond ~50/day.
- [ ] Scope S3 CORS to the Amplify domain instead of `*`.
- [ ] `/api/state` trusts the caller's `userId` param; it should derive identity from
      the session cookie server-side so one user can't read another's row.

---

## Demo script

1. Visit the live URL in a fresh window → lands on **`/login`**.
2. **Create account** → six-digit code → confirm.
3. **Onboarding**: paste a founder blurb → watch the beam read it → Claude returns
   tags → edit one → Enter Yellow.
4. **Bubble map**: point out size and distance both encoding overlap. Tap a
   *lower*-ranked bubble first — the smaller "You share N" proves the scoring is real.
5. **Nudge** fires → Connect → their answers arrive → record your own → send →
   celebration.
6. **DM** opens. Create a **hub**, add your connection.
7. **Cloud proof**: DynamoDB rows, the S3 object, the Cognito user — all live.

**If the room is empty:** flip `NEXT_PUBLIC_DEMO_PERSONAS=true`, rebuild, and create a
real account on top to show it isn't static.
