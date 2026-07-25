<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Yellow — project rules

**Read `PRIMER.md` first.** It covers the product, architecture, and the AWS gotchas
that have already cost real time. `ROADMAP.md` has current status; `DEPLOY.md` covers
Amplify. **Any UI work must follow `DESIGN.md`** — glass recipes, type ladder, button
grammar, the one-glow budget, and photo → initials-monogram avatars
(`lib/initials.ts`; never render `Profile.emoji`, never re-derive initials locally).

## Version specifics that break training-data assumptions

- Turbopack is the default — **never pass `--turbopack`**.
- `params` / `searchParams` are **Promises**; client pages use `use(params)`.
- Routing middleware is **`proxy.ts`** with a named `proxy` export, not `middleware.ts`.
- `cookies()` from `next/headers` is **async** — `await cookies()`.
- Tailwind is **v4, CSS-first**. There is **no `tailwind.config.js`** — do not create
  one. Tokens live in `app/globals.css` under `@theme inline`; prefer arbitrary
  values (`bg-[#0B0A08]`).
- `next lint` no longer exists and `next build` doesn't lint — but it **does**
  typecheck and will fail on type errors.

## Invariants — do not break these

- **`lib/types.ts` is a frozen contract.** Changing it ripples through every screen.
  Additive, optional fields (e.g. `Profile.photoUrl`) are the one safe way to extend
  it — every existing reader that ignores unknown fields keeps working unchanged.
  Anything else (renaming, removing, widening required shape) is not safe.
- **`lib/store.tsx`**: `hydrated` must always end `true` (three independent paths);
  the `revision` dirty-counter must keep gating persistence; `savedAt` drives
  last-write-wins. Breaking any of these hangs the app or destroys cloud state.
- **State is keyed by the Cognito `sub`**, resolved before the first read. Never key
  on a literal like `"me"` — that made every account share one row.
- **Anything published as *your* id (`setProfile` → `publishProfile`) must `await
  resolveIdentity()` first**, never a synchronous `currentUserId()`/
  `resolveDirectoryId()` fallback. That fallback races the async Cognito lookup: hit
  "Enter" on onboarding before `/api/auth/me` answers and you publish under a
  throwaway browser UUID forever, while your own server routes keep resolving your
  real `sub`. Two ids for one person means every pair with them silently splits into
  two half-filled `pair#` rows that never both complete — permanent "waiting on
  them" on both sides. Cost a real, already-live connection; see `ROADMAP.md`.
- **`AppStateProvider` mounts once per page load and stays mounted across every
  client-side navigation** — it lives in the root layout, so `resolveIdentity()`'s
  result and the hydrated profile never re-check themselves after a `router.push`.
  Any flow that changes *who is signed in* (login, signup-then-login) must navigate
  with a full reload (`window.location.assign`), never `router.push` — otherwise the
  app keeps rendering the previous session's identity and cached profile. The local
  `yellow:v1` cache is also owner-tagged (`toBlob`'s `owner` field): a blob written by
  a different Cognito `sub` than the one just resolved is discarded on hydrate rather
  than trusted, so a second account signing in on the same browser can never inherit
  the first account's profile. See `ROADMAP.md`.
- **Directory `people` and shared `hubs` never enter the persisted blob** (not
  localStorage, not the state row). `LocalAppState = Omit<AppState, 'hubs'>` enforces
  this for hubs at the type level — don't widen `LocalAppState` back to `AppState`.
- **Fail-soft is a feature, not an oversight.** Bedrock, the directory, S3, hubs, and
  the mic all degrade silently. The auth wall *deliberately* fails open when Cognito
  is unconfigured, because locking an app with no working auth is unrecoverable.
- **Bedrock model ID must be `us.anthropic.claude-haiku-4-5-20251001-v1:0`.** The
  un-prefixed ID fails with a misleading on-demand-throughput error.
- **The `yellow-voice-...` S3 bucket is private except one carve-out.** `photos/*`
  is public-read (see `PRIMER.md`) so profile photos load as plain `<img src>` with
  no per-viewer presign. Every other prefix (`audio/*`) stays private, presigned
  reads only. Don't widen the bucket policy beyond `photos/*`.
- **`BubbleField`'s pan/zoom must never call `setPointerCapture` when a pointerdown
  starts on a `<button>`.** Capturing there silently retargets the matching
  `pointerup`/`click` to the container instead of the button, so the tap does
  nothing — this broke every bubble/profile click for a while. See the check in
  `onPointerDown`.

## Conventions

- Components ship their own CSS via React 19's `<style href precedence="high">`
  (deduped by href) instead of editing `globals.css`.
- Server-only modules (`lib/aws.ts`, `lib/cognito.ts`) must never be imported from a
  `'use client'` file.
- Secrets live in `.env.local` (gitignored) and never in code, logs, or commits.
- Default to **no comments**; add one only where the *why* isn't evident from the code.
- **Do not create test/mock accounts** in the live `yellow-users`, `yellow-app`, or
  `yellow-hubs` tables (directly via `aws dynamodb`, a script, or the app). Testing is
  complete — the directory should only ever hold real accounts from here on. A batch
  of generated test rows and two demo accounts ("Hub Demo", "Guest Demo") were
  already created and removed; don't reintroduce that pattern.

## Verify before claiming done

`npx tsc --noEmit` → clean · `npm run build` → passes · exercise the real route
(curl or browser), don't assume. There are 9 known pre-existing `react-hooks/refs`
lint errors in `BubbleField`/`MatchNudge`/`ProfileCard` — don't count those as yours.
`node scripts/check-pair.mjs` is the red/green check for `lib/pair.ts` — run it after
touching pair-key or pair-view logic.

Debugging a "connection won't unlock" style report: don't trust the UI state alone —
query DynamoDB directly (`aws dynamodb get-item`/`scan` against `$YELLOW_TABLE` /
`$YELLOW_USERS_TABLE`, values in `.env.local`) to see whether the two sides actually
share one `pair#` row before proposing a fix. On Windows/Git Bash, `aws dynamodb`
crashes on any non-ASCII in the response (e.g. a stored emoji) — export
`PYTHONUTF8=1 PYTHONIOENCODING=utf-8` first. The same applies in reverse to
`--expression-attribute-values file://...`: write that JSON as pure ASCII
(`json.dump(..., ensure_ascii=True)` in Python) or the CLI fails with "Unable to load
paramfile ... text contents could not be decoded".
