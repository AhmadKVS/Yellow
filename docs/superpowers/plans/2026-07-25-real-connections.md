# Real Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make connections, voice intros, and DMs genuinely shared between two Yellow accounts, so the celebration only fires when both people have actually sent, intros are real recordings, and messages are written by people rather than canned replies.

**Architecture:** A shared "pair" row lands in the existing `yellow-app` DynamoDB table under a deterministic key `pair#<sortedA>#<sortedB>`. It holds each side's intro-sent flag, `connectedAt`, and an append-only message list. Voice intros are recorded once and stored on the user's `yellow-users` directory row, with audio in S3 behind presigned URLs. Clients poll the pair routes; server truth wins over local state for connection stage.

**Tech Stack:** Next.js 16.2.11 (App Router, Turbopack), React 19.2.4, Tailwind v4 CSS-first, DynamoDB (`@aws-sdk/lib-dynamodb`), S3 presigned URLs, Cognito session cookies.

**Spec:** `docs/superpowers/specs/2026-07-25-real-connections-design.md`

## Global Constraints

- Never pass `--turbopack`; it is the default.
- `params` / `searchParams` are Promises. Client pages read them with `use(params)`.
- `cookies()` from `next/headers` is async — `await cookies()`.
- Tailwind v4 CSS-first. No `tailwind.config.js`. Prefer arbitrary values (`bg-[#0B0A08]`).
- Components ship their own CSS via `<style href="..." precedence="high">`, not `globals.css`.
- **`lib/types.ts` is additive-only.** `Profile`, `SeedPersona`, `Connection`, `Message`, `Hub`, `AppState`, `MatchResult` must not change shape.
- **`lib/store.tsx` invariants:** `hydrated` always ends `true` via three independent paths; the `revision` dirty-counter keeps gating persistence; `savedAt` drives last-write-wins.
- **Pair and directory data never enter the persisted blob** — they live in `useState` outside the `useReducer` store, exactly like `people` does.
- Server-only modules (`lib/aws.ts`, `lib/cognito.ts`, `lib/pairServer.ts`, `lib/session.ts`) must never be imported from a `'use client'` file.
- Every new API route answers **200 with a degraded payload** on failure. The only exception is a genuine authorization failure (401).
- Bedrock model id stays `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- Default to no comments; add one only where the *why* isn't evident.
- Verification per task: `npx tsc --noEmit` clean, and `npm run build` clean at the end of each task that touches app code. There are 9 pre-existing `react-hooks/refs` lint errors in `BubbleField` / `MatchNudge` / `ProfileCard` — not ours, don't count them.

**Test approach:** this repo has no test framework and adding one is out of scope. The project's established cycle is `npx tsc --noEmit` → `npm run build` → exercise the real route. Pure helpers get a real red/green cycle via `scripts/check-pair.mjs`, matching the existing `scripts/*.mjs` convention.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `lib/pair.ts` | Pure, client-safe: pair key math, viewer mapping, `PairMessage` / `PairRecord` / `PairView` / `PairSummary` types |
| `lib/intro.ts` | Pure, client-safe: `VoiceClip` / `VoiceIntro` types, validation, client fetch helpers |
| `lib/session.ts` | Server-only: the one Identity rule, shared by every new route |
| `lib/pairServer.ts` | Server-only: DynamoDB reads/writes for pair rows |
| `lib/audioClient.ts` | Client-safe: upload a clip, resolve a presigned playback URL, cache by message id |
| `app/api/intro/route.ts` | GET someone's intro (presigned), POST my own |
| `app/api/pair/route.ts` | GET one pair, viewer-mapped |
| `app/api/pair/intro/route.ts` | POST mark my intro sent; stamp `connectedAt` and seed both intros when both are in |
| `app/api/pair/message/route.ts` | POST one message, atomic `list_append` |
| `app/api/pairs/route.ts` | GET every pair containing me, as summaries |
| `components/Toast.tsx` | Connection + new-message notification surface |
| `components/ChatComposer.tsx` | Text input plus mic button, extracted from the chat page |
| `scripts/check-pair.mjs` | Red/green check for `lib/pair.ts` |

**Modified**

| File | Change |
|---|---|
| `lib/types.ts` | Additive only — no new required fields on existing interfaces |
| `lib/people.ts` | `toPerson()` stops fabricating intros; `voiceIntro` passthrough |
| `lib/store.tsx` | Pair state + poller + server reconciliation of `connections` |
| `app/api/audio/route.ts` | Owner-scoped S3 keys; new `GET ?key=` |
| `app/connect/[id]/page.tsx` | Real intros, real send, "sent, waiting" state |
| `app/chat/[id]/page.tsx` | Canned replies deleted, polled thread, voice composer |
| `app/chats/page.tsx` | Unread counts from `/api/pairs` |
| `components/Celebration.tsx` | Copy |
| `components/TabBar.tsx`, `components/PhoneFrame.tsx` | Unread dot |
| `PRIMER.md`, `ROADMAP.md` | Architecture and status |

---

## Task 1: Pair primitives

**Files:**
- Create: `lib/pair.ts`
- Create: `scripts/check-pair.mjs`
- Modify: `package.json` (add `"check": "node scripts/check-pair.mjs"`)

**Interfaces:**
- Consumes: `Message` from `lib/types.ts`
- Produces:
  - `PAIR_PREFIX: 'pair#'`
  - `pairKey(one: string, two: string): string | null`
  - `pairMembers(key: string): [string, string] | null`
  - `otherMember(key: string, me: string): string | null`
  - `slotFor(record: Pick<PairRecord,'a'|'b'>, id: string): 'a' | 'b' | null`
  - `toViewerMessage(m: PairMessage, viewerId: string, personId: string): Message`
  - `messagePreview(m: PairMessage): string`
  - `toPairView(r: PairRecord, viewerId: string): PairView | null`
  - `toPairSummary(r: PairRecord, viewerId: string): PairSummary | null`
  - `isPairMessage(v: unknown): v is PairMessage`
  - types `PairMessage`, `PairRecord`, `PairView`, `PairSummary`

- [ ] **Step 1: Write the failing check**

`scripts/check-pair.mjs` asserts the properties that actually matter:

```js
import assert from 'node:assert/strict';
import { pairKey, otherMember, toPairView } from '../lib/pair.ts';

// Order-independence is the whole point of the key.
assert.equal(pairKey('bbb', 'aaa'), pairKey('aaa', 'bbb'));
assert.equal(pairKey('aaa', 'bbb'), 'pair#aaa#bbb');

// Fail-soft, never throw.
assert.equal(pairKey('', 'bbb'), null);
assert.equal(pairKey('aaa', 'aaa'), null);
assert.equal(pairKey('a#b', 'ccc'), null);

assert.equal(otherMember('pair#aaa#bbb', 'aaa'), 'bbb');
assert.equal(otherMember('pair#aaa#bbb', 'zzz'), null);

// A viewer who isn't a member gets nothing.
const record = {
  userId: 'pair#aaa#bbb', a: 'aaa', b: 'bbb',
  introA: { sentAt: 1 }, updatedAt: 2,
  messages: [{ id: 'm1', senderId: 'bbb', kind: 'text', text: 'hi', at: 5 }],
};
assert.equal(toPairView(record, 'zzz'), null);

// Slot flags resolve per viewer, not per storage position.
const asA = toPairView(record, 'aaa');
assert.equal(asA.myIntroSent, true);
assert.equal(asA.theirIntroSent, false);
assert.equal(asA.messages[0].from, 'them');

const asB = toPairView(record, 'bbb');
assert.equal(asB.myIntroSent, false);
assert.equal(asB.theirIntroSent, true);
assert.equal(asB.messages[0].from, 'me');

console.log('pair helpers OK');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --experimental-strip-types scripts/check-pair.mjs`
Expected: FAIL — `Cannot find module '../lib/pair.ts'`

- [ ] **Step 3: Implement `lib/pair.ts`**

Pure module, no AWS SDK, no `next/headers`, so `'use client'` pages can import it. Key rules:
- `pairKey` trims, rejects empty / identical / `#`-containing ids, sorts lexicographically.
- `toPairView` resolves `myIntroSent` / `theirIntroSent` from `slotFor`, not from storage order.
- `toViewerMessage` sets `from: senderId === viewerId ? 'me' : 'them'` — this is what keeps `Message` in `lib/types.ts` unchanged.
- `messagePreview` returns `'Voice note'` for `kind: 'voice'`, truncates text at 120 chars.

- [ ] **Step 4: Run the check**

Run: `node --experimental-strip-types scripts/check-pair.mjs`
Expected: `pair helpers OK`

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/pair.ts scripts/check-pair.mjs package.json
git commit -m "Add shared pair primitives and their check"
```

---

## Task 2: Server identity rule

**Files:**
- Create: `lib/session.ts`

**Interfaces:**
- Consumes: `getSession()`, `isCognitoConfigured()` from `lib/cognito.ts`
- Produces: `resolveCaller(fallbackId?: string | null): Promise<string | null>`

Every new route resolves its caller through this one function. Duplicating the rule per route is how one of them ends up trusting a body field.

- [ ] **Step 1: Implement**

```ts
import { getSession, isCognitoConfigured } from './cognito';

/**
 * Who is calling. The session `sub` when there is one; otherwise the caller's
 * own claim, but ONLY while Cognito is unconfigured.
 *
 * That second branch is the deliberate fail-open: locking an app with no
 * working auth is unrecoverable, and local dev has no pool. With Cognito
 * configured, an unauthenticated caller is `null` and the route must 401 —
 * which is what stops one account reading another's thread.
 */
export async function resolveCaller(
  fallbackId?: string | null,
): Promise<string | null> {
  const session = await getSession();
  if (session?.sub) return session.sub;
  if (isCognitoConfigured()) return null;
  const claimed = typeof fallbackId === 'string' ? fallbackId.trim() : '';
  return claimed || null;
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/session.ts
git commit -m "Add the one server-side identity rule for pair routes"
```

---

## Task 3: Owner-scoped audio keys and presigned reads

**Files:**
- Modify: `app/api/audio/route.ts`
- Create: `lib/audioClient.ts`

**Interfaces:**
- Consumes: `resolveCaller` (Task 2), `s3` / `BUCKET_NAME` from `lib/aws.ts`, `setAudioUrl` / `getAudioUrl` from `lib/audioStore.ts`
- Produces:
  - `POST /api/audio { messageId, userId? } -> { ok, putUrl, getUrl, key }`
  - `GET /api/audio?key=<s3key> -> { ok, getUrl }`
  - `lib/audioClient.ts`: `uploadClip(ownerId: string, messageId: string, blob: Blob): Promise<string | null>` returning the key, and `resolvePlaybackUrl(messageId: string, s3Key?: string): Promise<string | null>`

Two blockers live here. The key is hardcoded `audio/me/<messageId>.webm`, so every account writes into one prefix and collides. And there is no route to presign a **read** by key, so the other person physically cannot fetch a clip.

- [ ] **Step 1: Change the key shape**

`audio/me/${messageId}.webm` becomes `audio/${ownerId}/${messageId}.webm`, where `ownerId` comes from `resolveCaller(body.userId)`. Never from a raw body field.

- [ ] **Step 2: Add `GET ?key=`**

Validate before presigning, so the parameter can't be walked to an arbitrary object:

```ts
const AUDIO_KEY = /^audio\/[A-Za-z0-9._:-]{1,128}\/[A-Za-z0-9._-]{1,128}\.webm$/;
```

Return `{ ok: false }` at **200** for a bad key — playback degrading to a dead waveform is the designed behaviour, not an error surface.

- [ ] **Step 3: Write `lib/audioClient.ts`**

Moves the `uploadClip` helper currently inlined at the bottom of `app/connect/[id]/page.tsx` into one place both the connect screen and the chat composer use. Keeps the existing 2.5s budget and every-failure-returns-null contract. `resolvePlaybackUrl` checks `lib/audioStore.ts` first, falls back to `GET /api/audio?key=`, and caches the result back into the store.

- [ ] **Step 4: Verify against the real route**

```bash
npm run dev
curl -s -X POST localhost:3000/api/audio -H 'content-type: application/json' \
  -d '{"messageId":"t1","userId":"u_test"}'
# expect key: "audio/u_test/t1.webm"
curl -s 'localhost:3000/api/audio?key=audio/u_test/t1.webm'   # expect ok:true
curl -s 'localhost:3000/api/audio?key=../../etc/passwd'       # expect ok:false, status 200
```

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run build
git add app/api/audio/route.ts lib/audioClient.ts
git commit -m "Scope audio keys per owner and presign reads by key"
```

---

## Task 4: Voice intro storage

**Files:**
- Create: `lib/intro.ts`
- Create: `app/api/intro/route.ts`
- Modify: `lib/people.ts`
- Modify: `lib/types.ts` (additive)

**Interfaces:**
- Consumes: `resolveCaller` (Task 2), `USERS_TABLE_NAME` from `lib/people.ts`, `ddb` from `lib/aws.ts`
- Produces:
  - `VoiceClip { s3Key?: string; durationSec: number; waveSeed: number; text?: string; url?: string }`
  - `VoiceIntro { who: VoiceClip; building: VoiceClip; lookingFor: VoiceClip; recordedAt: number }`
  - `INTRO_KEYS: readonly ['who','building','lookingFor']`, `IntroKey`
  - `isVoiceIntro(v: unknown): v is VoiceIntro`
  - `fetchIntro(userId: string): Promise<VoiceIntro | null>`
  - `saveIntro(intro: VoiceIntro, userId?: string): Promise<boolean>`
  - `GET /api/intro?userId= -> { intro: VoiceIntro | null }` with `url` presigned onto each clip
  - `POST /api/intro { intro } -> { ok }`

- [ ] **Step 1: Write `lib/intro.ts`**

Pure types + validation + the two client fetch helpers. `url` is transient — presigned server-side at read time, never stored.

- [ ] **Step 2: Write `app/api/intro/route.ts`**

GET reads the `yellow-users` row for `userId` and returns `item.voiceIntro`, presigning a `url` onto each clip that has an `s3Key`. Missing row, missing intro, or a DynamoDB failure all return `{ intro: null }` at 200.

POST resolves the caller, then `UpdateCommand` sets `voiceIntro` on **their own** row only. A caller can never write someone else's intro.

- [ ] **Step 3: Stop fabricating intros in `lib/people.ts`**

`toPerson()` currently synthesises `intro.who` / `.building` / `.lookingFor` from the tagline (lines ~259-267). Those strings are then rendered as if they were recorded answers. Replace the fabricated branch: keep `intro` for the bundled demo personas that genuinely have one, and add `voiceIntro?: VoiceIntro` passthrough. Real users with no recording get `voiceIntro: undefined`, and the UI says so honestly.

`SeedPersona.intro` stays required so `lib/seed.ts` and every existing consumer still typecheck; `DirectoryPerson.intro` stays optional. What changes is that a *real* user's synthesised intro is no longer presented as a voice note.

- [ ] **Step 4: Verify**

```bash
curl -s -X POST localhost:3000/api/intro -H 'content-type: application/json' \
  -d '{"userId":"u_test","intro":{"who":{"durationSec":3,"waveSeed":1,"text":"hi"},"building":{"durationSec":3,"waveSeed":2,"text":"x"},"lookingFor":{"durationSec":3,"waveSeed":3,"text":"y"},"recordedAt":1}}'
curl -s 'localhost:3000/api/intro?userId=u_test'   # expect the intro back
curl -s 'localhost:3000/api/intro?userId=nobody'   # expect { intro: null }, status 200
```

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run build
git add lib/intro.ts lib/types.ts lib/people.ts app/api/intro/route.ts
git commit -m "Store voice intros on the directory row, stop fabricating them"
```

---

## Task 5: Pair routes

**Files:**
- Create: `lib/pairServer.ts`
- Create: `app/api/pair/route.ts`
- Create: `app/api/pair/intro/route.ts`
- Create: `app/api/pair/message/route.ts`
- Create: `app/api/pairs/route.ts`

**Interfaces:**
- Consumes: `pairKey`, `toPairView`, `toPairSummary`, `slotFor`, `isPairMessage`, `PairRecord`, `PairMessage` (Task 1); `resolveCaller` (Task 2); `ddb` / `TABLE_NAME` from `lib/aws.ts`
- Produces:
  - `lib/pairServer.ts`: `readPair(key)`, `ensurePair(me, them)`, `markIntroSent(me, them, seed)`, `appendMessage(me, them, message)`, `listPairsFor(me)`
  - `GET /api/pair?with=<id> -> { pair: PairView | null }`
  - `POST /api/pair/intro { with, clips? } -> { pair: PairView | null, connected: boolean }`
  - `POST /api/pair/message { with, message } -> { pair: PairView | null }`
  - `GET /api/pairs -> { pairs: PairSummary[] }`

- [ ] **Step 1: Write `lib/pairServer.ts`**

`appendMessage` must be atomic. A read-modify-write drops a message whenever both people send inside one round trip:

```ts
new UpdateCommand({
  TableName: TABLE_NAME,
  Key: { userId: key },
  UpdateExpression:
    'SET messages = list_append(if_not_exists(messages, :empty), :one), updatedAt = :now',
  ExpressionAttributeValues: { ':empty': [], ':one': [message], ':now': Date.now() },
})
```

`ensurePair` is an idempotent `UpdateCommand` with `if_not_exists` on `a`, `b`, `updatedAt` — never a `PutCommand`, which would wipe an existing thread.

`markIntroSent` sets `introA` or `introB` per `slotFor`, then re-reads and, if both are present and `connectedAt` is absent, stamps it with `attribute_not_exists(connectedAt)` as the condition so a race can't stamp twice.

`listPairsFor` scans `TABLE_NAME` with `begins_with(userId, :prefix)` and filters to rows containing `me`.

- [ ] **Step 2: Membership check in every route**

Each route resolves the caller, computes `pairKey(me, them)`, and returns `{ pair: null }` when the caller isn't a member. `toPairView` already returns `null` for a non-member, so the check is structural rather than a forgettable `if`.

- [ ] **Step 3: Seed both intros into the thread on connect**

When `markIntroSent` stamps `connectedAt`, append both sides' three clips as `PairMessage`s so the intro exchange is visible in *both* threads — the user asked for exactly this. Ids are deterministic (`intro-<ownerId>-<key>`) so a retry can't double-post.

- [ ] **Step 4: Verify the gate with two identities**

```bash
# A sends. Must NOT connect.
curl -s -X POST localhost:3000/api/pair/intro -H 'content-type: application/json' \
  -d '{"userId":"u_a","with":"u_b"}'      # expect connected:false
# B sends. Now it connects.
curl -s -X POST localhost:3000/api/pair/intro -H 'content-type: application/json' \
  -d '{"userId":"u_b","with":"u_a"}'      # expect connected:true
# A non-member sees nothing.
curl -s 'localhost:3000/api/pair?userId=u_c&with=u_a'   # expect pair:null
```

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run build
git add lib/pairServer.ts app/api/pair app/api/pairs
git commit -m "Add shared pair routes with an atomic message append"
```

---

## Task 6: Store integration

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 4, 5
- Produces, on `AppStateApi`:
  - `pairs: PairSummary[]`
  - `pairsLoaded: boolean`
  - `myIntro: VoiceIntro | null`
  - `unreadFor(personId: string): number`
  - `unreadTotal: number`
  - `markThreadSeen(personId: string): void`
  - `notice: { personId: string; kind: 'connected' | 'message' } | null`
  - `dismissNotice(): void`
  - `refreshPairs(): Promise<void>`

- [ ] **Step 1: Add pair state outside the reducer**

`useState`, next to `people`. `toBlob()` only ever serialises `store.app`, so pair data structurally cannot reach localStorage or the state row and cannot bump `revision`. Do not add it to `AppState`.

- [ ] **Step 2: Poll `/api/pairs`**

8s interval, `document.visibilityState === 'hidden'` guard, plus `focus` and `visibilitychange` listeners — the same shape as the existing `PEOPLE_REFRESH_MS` effect.

- [ ] **Step 3: Reconcile `connections` from server truth**

For each summary, dispatch `SET_STAGE` / `SEND_MY_INTRO` / `RECEIVE_THEIR_INTRO` so local `Connection` matches the server. **A local `connected` with no server pair record resets to `intro_pending`** — this is the fresh-start migration that deletes the fake connections.

- [ ] **Step 4: Unread tracking**

A `localStorage` map `yellow:seen` of `personId -> messageCount`. Unread = `summary.messageCount - seen[personId]`, floored at 0. This is view state, not connection state, so it stays out of the persisted blob.

- [ ] **Step 5: Notices**

Diff each poll against the previous snapshot. A pair gaining `connectedAt` that we didn't just trigger → `notice.kind = 'connected'`. A pair whose `messageCount` grew with `lastSenderIsMe === false` → `'message'`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run build
git add lib/store.tsx
git commit -m "Poll shared pairs and reconcile connection stage from the server"
```

---

## Task 7: Connect screen

**Files:**
- Modify: `app/connect/[id]/page.tsx`

- [ ] **Step 1: Replace the fake arrival animation**

Delete `ARRIVAL_MS` and the `setArrived` timers. Their notes are either recorded or they aren't; a fake "typing" delay on a recording that already exists is theatre.

- [ ] **Step 2: Load their real intro**

`GET /api/intro?userId=<them>`. Three states: their clips, an honest empty state (*"Ahmad hasn't recorded his intro yet. Send yours and he'll get it the moment he does."*), or loading.

- [ ] **Step 3: Prefill my saved intro**

If `myIntro` exists, show it with a "record again" affordance rather than three empty recorders.

- [ ] **Step 4: Real send**

Replace the `sendMyIntro()` + `receiveTheirIntro()` pair at lines ~397-399 — the actual bug — with:
1. upload clips (best-effort, existing 2.5s budget),
2. `POST /api/intro` to save my reusable intro,
3. `POST /api/pair/intro`,
4. branch on the response: `connected` → `Celebration`; otherwise → the **new "sent, waiting" state**.

- [ ] **Step 5: The waiting state**

Never existed before. Eyebrow *"Intro sent"*, title *"Your intro is with Ahmad."*, body *"He'll get it next time he opens Yellow. The chat opens the moment he sends his back."* Poll `/api/pair?with=` every 4s while visible; flip to `Celebration` if it connects while the page is open.

- [ ] **Step 6: Rail reads server truth**

Left half lit from `pair.theirIntroSent`, right from `pair.myIntroSent`.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npm run build
git add app/connect/[id]/page.tsx
git commit -m "Connect screen: real intros, real send, honest waiting state"
```

---

## Task 8: Chat screen and voice DMs

**Files:**
- Modify: `app/chat/[id]/page.tsx`
- Create: `components/ChatComposer.tsx`

- [ ] **Step 1: Delete the fake replies**

Remove `REPLY_DELAY_MS`, `GENERIC_REPLIES`, `replyTimer`, `pendingReply`, `threadRef`, `personaRef`, `addMessageRef`, and the `cannedReplies` read (lines ~18-26, ~441-476, ~721-747). This is the "the AI replies to me" complaint, and none of it survives.

- [ ] **Step 2: Thread from the pair record**

`GET /api/pair?with=<id>`, poll 4s while visible. Keep the existing `rows` grouping, day dividers, and `VoiceBody` rendering untouched — they already work on `Message`.

- [ ] **Step 3: Send for real**

`POST /api/pair/message`. Optimistically append locally, reconcile on the next poll, and surface a quiet "not sent" marker if the post fails rather than an error screen.

- [ ] **Step 4: `components/ChatComposer.tsx`**

Text input plus a mic button. Recording reuses `VoiceRecorder`'s capture path; on stop it uploads via `lib/audioClient.ts` and posts `kind: 'voice'` with `s3Key`, `durationSec`, `waveSeed`. Mic denied falls back to text only, exactly as the intro recorder does. Extracted to its own file because the chat page is already ~1050 lines.

- [ ] **Step 5: Playback across accounts**

`VoiceBody` resolves its URL through `resolvePlaybackUrl(message.id, message.s3Key)`. Also fixes the standing bug where your own notes go silent after a refresh.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run build
git add app/chat/[id]/page.tsx components/ChatComposer.tsx
git commit -m "Real messaging: delete canned replies, poll the shared thread, add voice DMs"
```

---

## Task 9: Notifications, copy, and docs

**Files:**
- Create: `components/Toast.tsx`
- Modify: `components/Celebration.tsx`, `components/TabBar.tsx`, `components/PhoneFrame.tsx`, `app/chats/page.tsx`
- Modify: `PRIMER.md`, `ROADMAP.md`

- [ ] **Step 1: `components/Toast.tsx`**

Reads `notice` from the store. *"You're connected with Ahmad — say hi"* linking to `/chat/<id>`; *"Ahmad sent you a message"* for the message case. Auto-dismisses after 6s, respects `prefers-reduced-motion`, ships its own CSS via `<style href="yellow-toast" precedence="high">`.

- [ ] **Step 2: Mount it in `PhoneFrame`**

Above the tab bar on mobile, top-right on desktop. Skip it on chromeless routes (`/`, `/onboarding`, `/reset`, `/login`, `/signup`).

- [ ] **Step 3: Unread dot**

`unreadTotal` from the store onto the Chats tab in `TabBar` and the sidebar nav item. Per-thread counts in `app/chats/page.tsx`.

- [ ] **Step 4: Celebration copy**

`components/Celebration.tsx:233-235`:

```
You both put yourself out there before either of you had to. The chat is open.
```

replacing *"You both went first. That's the whole idea — and the chat is open now."*

- [ ] **Step 5: Docs**

`PRIMER.md` gets the pair record in Architecture and the new rows in the fail-soft table. `ROADMAP.md` moves the P2 items ("real users have no intro", "voice notes only play back in-session") to Shipped and drops the canned-reply line from the DM description.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run build
git add -A
git commit -m "Add connection notifications, unread counts, and honest celebration copy"
```

---

## Task 10: Two-account walkthrough

**Files:** none — this is the gate that decides whether any of the above is real.

Per `AGENTS.md`: exercise the real route, don't assume.

- [ ] **Step 1: Two browser profiles, two accounts**

Separate profiles, not two tabs — `ROADMAP.md` P1 documents that same-browser account switching briefly shows the previous user's profile.

- [ ] **Step 2: Walk the gate**

- [ ] A opens `/connect/B`, sees **"B hasn't recorded their intro yet"** — not fabricated text
- [ ] A records three answers and sends
- [ ] **A sees "Your intro is with B" — NOT the celebration.** This is the reported bug; if a celebration appears here, the task failed
- [ ] B opens `/connect/A` and **hears A's actual recording**
- [ ] B sends → both flip to connected
- [ ] **A gets the toast without reloading**
- [ ] B's celebration reads *"You both put yourself out there…"*

- [ ] **Step 3: Walk the thread**

- [ ] Both intros appear in **both** accounts' threads
- [ ] A sends text → appears on B within one poll, and **no reply is generated**
- [ ] B sends a voice note → A hears it
- [ ] Unread dot clears on open

- [ ] **Step 4: Walk the failure paths**

- [ ] Deny the mic → typed intro and typed DMs still work
- [ ] Kill the network mid-send → quiet "not sent", no error screen
- [ ] Reload mid-thread → voice notes still play (via presigned GET)

- [ ] **Step 5: Final verification and commit**

```bash
npx tsc --noEmit    # clean
npm run build       # passes
npm run lint        # only the 9 known react-hooks/refs errors
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Pair record + atomic append | 1, 5 |
| Voice intro storage | 4 |
| Audio routes (owner keys, presigned read) | 3 |
| New API routes | 4, 5 |
| Identity rule | 2 |
| Client state / no persistence leak | 6 |
| Polling intervals | 6, 7, 8 |
| Connect screen behaviour | 7 |
| Chat screen + voice DMs | 8 |
| Notifications | 6, 9 |
| Celebration copy | 9 |
| Fail-soft matrix | 3, 5, 7, 8, 10 |
| Fresh-start migration | 6 |
| Verification | 10 |

No gaps.

**Placeholder scan:** none. Every step names files, exact identifiers, and the command that proves it.

**Type consistency:** `pairKey` / `otherMember` / `slotFor` / `toPairView` / `toPairSummary` / `toViewerMessage` / `messagePreview` / `isPairMessage` are defined in Task 1 and used under those exact names in Tasks 5 and 6. `resolveCaller` is defined in Task 2 and used in Tasks 3, 4, 5. `uploadClip` / `resolvePlaybackUrl` are defined in Task 3 and used in 7 and 8. `VoiceClip` / `VoiceIntro` / `INTRO_KEYS` are defined in Task 4 and used in 6 and 7. `PairSummary` fields consumed in Task 6 (`messageCount`, `lastSenderIsMe`, `connectedAt`) all exist on the Task 1 definition.
