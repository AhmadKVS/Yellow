<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Yellow — project rules

**Read `PRIMER.md` first.** It covers the product, architecture, and the AWS gotchas
that have already cost real time. `ROADMAP.md` has current status; `DEPLOY.md` covers
Amplify.

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

## Verify before claiming done

`npx tsc --noEmit` → clean · `npm run build` → passes · exercise the real route
(curl or browser), don't assume. There are 9 known pre-existing `react-hooks/refs`
lint errors in `BubbleField`/`MatchNudge`/`ProfileCard` — don't count those as yours.
