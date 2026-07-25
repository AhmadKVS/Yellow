# Real connections, real intros, real messaging

**Date:** 2026-07-25
**Status:** approved, ready for planning

## Problem

Yellow's core loop is a lie in three places, all tracing to one root cause: **two
accounts share no server-side record.** Everything lives in one user's `yellow-app`
row, keyed by their own Cognito `sub`.

The visible symptoms:

1. **The celebration fires when only one person has sent.**
   `app/connect/[id]/page.tsx` calls `sendMyIntro()` *and* `receiveTheirIntro()` back
   to back on the same store. You tell your own browser they answered, so
   `promote()` stamps `connectedAt` and `Celebration` mounts. The other account
   knows nothing about it.

2. **Their voice intro is fabricated.**
   `toPerson()` in `lib/people.ts` synthesises `intro.who` / `.building` /
   `.lookingFor` from the person's tagline whenever the directory row has no real
   one — which is always, because nothing ever writes one. The connect screen then
   renders those strings as if they were recorded answers, complete with a
   `waveSeed` waveform and an `estimateDuration()` runtime.

3. **DM replies are canned.**
   `app/chat/[id]/page.tsx` sets a 1.2s timer and answers you with
   `persona.cannedReplies[n]`, falling through to three hardcoded `GENERIC_REPLIES`.
   Not AI, but equally fake, and the user experiences it as the app talking to
   itself.

4. **No notifications.** Nothing tells you someone connected with you, because
   nothing can — there is no shared state to observe.

Two supporting bugs block any fix:

- `app/api/audio/route.ts` hardcodes the S3 key as `audio/me/<messageId>.webm`.
  Every user writes into the same `me/` prefix, and there is no `ownerId` in the
  path, so clips collide across accounts.
- There is no route to presign a **read** by key. Only the uploader gets a `getUrl`,
  and only in the upload response. Another account physically cannot fetch your
  audio.

## Decisions taken

| Question | Decision |
|---|---|
| Intro model | **Record once, reused.** Your three answers live on your profile; anyone who connects hears that recording. Re-recordable any time. |
| Reveal order | **Immediately.** Their real notes are on the screen when you arrive; you answer back. The gate still holds — no DM until both intros exist. |
| Voice in DMs | **In scope.** The chat composer gets a mic button; voice messages sync to both accounts like text. |
| Existing data | **Fresh start.** Server truth wins. Any locally-`connected` pair with no server pair record resets to "not open yet". |

## Architecture

### The pair record

One new item shape in the **existing** `yellow-app` table (PK `userId`). No new
table, no IAM change, no `scripts/provision.mjs` run.

```
userId:       "pair#<smaller-id>#<larger-id>"   // lexicographic sort, deterministic
a, b:         the two member ids, sorted
introA:       { sentAt: number } | absent
introB:       { sentAt: number } | absent
connectedAt:  number | absent   // stamped only when introA AND introB are set
messages:     PairMessage[]
updatedAt:    number
```

```ts
interface PairMessage {
  id: string;
  senderId: string;          // NOT 'me' | 'them' — the record is shared
  kind: 'text' | 'voice';
  text?: string;
  durationSec?: number;
  waveSeed?: number;
  s3Key?: string;
  at: number;
}
```

`senderId` is mapped to `Message.from: 'me' | 'them'` at read time, per viewer. This
is what keeps **`lib/types.ts` frozen** — the existing `Profile`, `Connection`,
`Message`, `AppState`, `Hub`, `MatchResult` are untouched. Only new interfaces are
added.

**Appends are atomic.** Sending a message is a single `UpdateCommand`:

```
SET messages = list_append(if_not_exists(messages, :empty), :one)
```

A read-modify-write would drop a message whenever both people send inside one round
trip. `list_append` cannot.

Row size ceiling is DynamoDB's 400 KB. Messages carry metadata only — audio is in S3
— so that is thousands of messages per pair. Adequate; noted as a known ceiling, not
solved.

### Voice intro storage

The directory row in `yellow-users` gains one optional attribute:

```ts
interface VoiceClip {
  s3Key: string;
  durationSec: number;
  waveSeed: number;
  text?: string;             // typed fallback, or a transcript
}

interface VoiceIntro {
  who: VoiceClip;
  building: VoiceClip;
  lookingFor: VoiceClip;
  recordedAt: number;
}
```

`DirectoryPerson.intro` (the three-strings shape) stays as-is so nothing that reads
it breaks. `voiceIntro` is the new, real one. `toPerson()` **stops fabricating**: when
there is no `voiceIntro`, downstream gets `null` and the UI says so honestly.

### Audio routes

`app/api/audio/route.ts` changes:

- `POST { messageId }` → key becomes `audio/<ownerId>/<messageId>.webm`, where
  `ownerId` is resolved by the Identity rule below — from the session when there is
  one, never from an arbitrary body field. This fixes the cross-account collision.
- **New** `GET ?key=<s3key>` → presigns a read for that key and returns `{ getUrl }`.
  Keys are validated against `^audio/[A-Za-z0-9._:-]{1,128}/[A-Za-z0-9._-]{1,128}\.webm$`
  so the parameter cannot be walked into an arbitrary object.

Read access is intentionally not scoped per-pair: any signed-in user who holds a key
can presign it. Keys are unguessable ids handed out only inside a thread you are a
member of. Documented as a deliberate hackathon tradeoff, not an oversight.

### New API routes

All return **200 with a degraded payload** on failure. Fail-soft is a product
invariant here, not an accident.

| Route | Purpose |
|---|---|
| `GET /api/intro?userId=` | That person's `voiceIntro`, each clip carrying a presigned `getUrl`. `{ intro: null }` when they have not recorded. |
| `POST /api/intro` | Save my `voiceIntro` onto my `yellow-users` row. |
| `GET /api/pair?with=<id>` | The pair record between me and them, viewer-mapped. |
| `POST /api/pair/intro` | Mark my side sent. If both sides are now set, stamp `connectedAt` and seed both intros into `messages`. |
| `POST /api/pair/message` | Atomic `list_append` of one message. |
| `GET /api/pairs` | Summary of every pair containing me: stage, `connectedAt`, last message, counterpart id. Drives notifications and `/chats`. |

`GET /api/pairs` is a `Scan` with `begins_with(userId, 'pair#')`, filtered in the
handler to rows containing my id. `/api/people` already scans `yellow-users`, so this
matches the existing pattern and stays cheap at demo scale. A GSI would be the real
answer at volume; explicitly out of scope.

### Identity

Every new route resolves the caller as:

```
session = await getSession()          // lib/cognito.ts, decodes the httpOnly cookie
if (session) use session.sub
else if (!isCognitoConfigured()) fall back to the client-supplied id
else 401
```

This closes the "anyone can read anyone's thread" hole that `/api/state` still has
(tracked in `ROADMAP.md` P3) **while preserving the deliberate fail-open**: with
Cognito unconfigured, local dev keeps working exactly as it does today. Locking an
app that has no working auth is unrecoverable — that rule holds here too.

The pair record is never returned unless the caller is one of its two members.

### Client state

Pair data lives in **its own `useState` inside `AppStateProvider`, outside the
`useReducer` store** — structurally identical to how `people` is handled today.
`toBlob()` only ever serialises `store.app`, so pair data cannot reach localStorage or
the user's state row, and cannot bump `revision`. There is nothing to strip.

Store invariants that must survive, verbatim from `AGENTS.md`:

- `hydrated` always ends `true` via three independent paths.
- `revision` dirty-counter keeps gating persistence.
- `savedAt` last-write-wins keeps reconciling local against DynamoDB.
- Directory `people` never enter the persisted blob.
- State keyed by the Cognito `sub`, resolved before the first read.

New rule: **for connection stage, the server is authoritative.** The poller
reconciles `state.connections[personId]` from `/api/pairs`. A local `connected` with
no server pair record resets to `intro_pending` — that is the fresh-start migration,
and it is what deletes the fake connections.

### Polling

No WebSockets. Amplify SSR/WEB_COMPUTE makes them awkward and the payoff at two
concurrent users is nil.

| Surface | Interval | Notes |
|---|---|---|
| Open thread (`/chat/[id]`) | 4 s | Visible tabs only |
| Connect screen (`/connect/[id]`) | 4 s | Watches for their intro / the unlock |
| Global notification poll | 8 s | Visible tabs only; also on `focus` and `visibilitychange` |

Mirrors the existing `PEOPLE_REFRESH_MS = 20_000` pattern in `lib/store.tsx`, including
its `document.visibilityState === 'hidden'` guard.

## Screen behaviour

### `/connect/[id]`

- **Their column** plays their real clips via presigned GET. When they have no
  `voiceIntro`: an honest empty state — *"Ahmad hasn't recorded his intro yet. Send
  yours and he'll get it the moment he does."* The fabricated-intro path is deleted.
- **My column**: if I already have a `voiceIntro`, it is shown pre-filled with a
  "record again" affordance. If not, I record here and it saves to my profile on send.
- **Send** → `POST /api/pair/intro`. The response decides the next screen:
  - `connectedAt` present → `Celebration`.
  - otherwise → a **"sent, waiting" state**: *"Your intro is with Ahmad."* This state
    is the entire fix for the reported bug. It never existed before.
- The split-node rail reads server truth: left half lit when their intro is on the
  pair record, right half when mine is.

### `/chat/[id]`

- The canned-reply path is **deleted**: `REPLY_DELAY_MS`, `GENERIC_REPLIES`,
  `replyTimer`, `threadRef`/`personaRef` reply plumbing, and the `cannedReplies` read.
- Thread renders from the pair record, `senderId` mapped to `from`.
- Composer gains a mic button beside the text input, reusing `VoiceRecorder`'s
  capture path. Recording → upload to S3 → `POST /api/pair/message` with `kind:
  'voice'`, `s3Key`, `durationSec`, `waveSeed`.
- Voice playback resolves through `GET /api/audio?key=`, cached in `lib/audioStore.ts`
  by message id. This also fixes the standing bug where your own notes stop playing
  after a refresh.
- The locked state keeps its existing copy, which is already correct — it reads the
  intro flags honestly. It now reads them from the server.

### Notifications

The global poller diffs `/api/pairs` against the previous snapshot:

- A pair flips to `connected` and I was not the one who triggered it → toast:
  *"You're connected with Ahmad — say hi"*, tapping goes to `/chat/<id>`.
- New messages in any pair → unread count, dot on the Chats tab.
- If I happen to be on that person's `/connect` or `/chat` screen when the flip
  lands, the full `Celebration` shows instead of the toast.

"Last seen" per pair is a local-only concern (a small `localStorage` map keyed by
pair id) — it is not connection state and does not belong in the persisted blob.

### Celebration copy

Only reachable when the server has stamped `connectedAt`.

```
BOTH INTROS IN
You're connected!
You both put yourself out there before either of you had to. The chat is open.
```

Replaces *"You both went first. That's the whole idea — and the chat is open now."*

## Fail-soft matrix

Extends the table in `PRIMER.md`. Every remote dependency degrades; none break.

| Dependency down | Behaviour |
|---|---|
| `/api/pair*` unreachable | Thread renders the last polled snapshot; sends queue in component state and retry on the next poll; a quiet "not synced" marker. Never an error screen. |
| S3 upload fails | Message still posts with `text`/duration metadata and no `s3Key`. The sender plays from their in-session object URL; the recipient sees a waveform with playback disabled. The connection still completes — unchanged from today. |
| Presigned GET fails | Waveform renders, playback disabled. No error surface. |
| Their `voiceIntro` absent | Honest empty state. Never fabricated text. |
| Microphone denied | Typed-text intro and typed DMs, exactly as today. |
| Cognito unconfigured | Routes accept the client-supplied id. Auth wall stays failed-open. |

## Files

**New**

- `lib/pair.ts` — client-safe pure helpers: `pairKey(a, b)`, `viewerMap()`,
  `PairRecord` / `PairMessage` / `PairSummary` types. No AWS SDK, so a `'use client'`
  file can import it.
- `lib/intro.ts` — client-safe `VoiceClip` / `VoiceIntro` types and fetch helpers.
- `app/api/intro/route.ts`
- `app/api/pair/route.ts`
- `app/api/pair/intro/route.ts`
- `app/api/pair/message/route.ts`
- `app/api/pairs/route.ts`
- `components/Toast.tsx` — the connection/message notification surface.

**Modified**

- `app/api/audio/route.ts` — owner-scoped keys, new `GET ?key=`.
- `lib/people.ts` — `toPerson()` stops fabricating `intro`; `voiceIntro` passthrough.
- `lib/store.tsx` — pair state in its own `useState`, notification poller, server
  reconciliation of `connections`.
- `app/connect/[id]/page.tsx` — real intros, real send, waiting state.
- `app/chat/[id]/page.tsx` — canned replies deleted, polled thread, voice composer.
- `app/chats/page.tsx` — unread counts from `/api/pairs`.
- `components/Celebration.tsx` — copy.
- `components/TabBar.tsx` / `components/PhoneFrame.tsx` — unread dot.
- `lib/types.ts` — **additive only**, new interfaces, nothing existing changed.
- `PRIMER.md`, `ROADMAP.md` — architecture and status.

## Verification

Per `AGENTS.md`, none of this counts as done without:

- `npx tsc --noEmit` clean.
- `npm run build` passing.
- The real routes exercised — curl or browser, not assumed.
- Two accounts in two separate browser profiles walking the whole loop: A records and
  sends → A sees "waiting on B", **not** a celebration → B opens `/connect/A`, hears
  A's real clips → B sends → both flip to connected → A gets the toast without
  reloading → both send text and voice, each appearing on both sides.

The 9 known `react-hooks/refs` lint errors in `BubbleField` / `MatchNudge` /
`ProfileCard` are pre-existing and are not counted against this work.

## Out of scope

- Email or web-push notification. In-app only.
- Hub chat.
- A GSI for pair lookup. The `Scan` is adequate at demo scale.
- JWKS signature verification in `proxy.ts` — still tracked as `ROADMAP.md` P3.
- Transcription of voice notes. `VoiceClip.text` exists for the typed fallback and is
  left open for transcripts later.
