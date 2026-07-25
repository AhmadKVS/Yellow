# Profile photos

**Date:** 2026-07-25
**Status:** approved, ready for planning

## Problem

Every bubble renders as an emoji on a gradient disc (`components/Bubble.tsx`). The
user wants people to be able to use a real photo of themselves instead — the emoji
should remain available, but a photo should be selectable as the alternate avatar,
same as it works on most social apps.

## Decisions taken

| Question | Decision |
|---|---|
| Where to set a photo | Onboarding (`app/onboarding/page.tsx`) **and** Settings (`app/settings/page.tsx`) — both already have an emoji-grid avatar picker; the photo option is added to both. |
| Photo vs. emoji | One avatar, two ways to set it. Uploading a photo replaces the emoji as the active avatar; the last-picked emoji is retained so removing the photo reverts to it, not to a default. |
| Storage/serving | Public-read S3 prefix. Photos are not sensitive the way voice clips are — every match is going to see this image passively on every page load, so a plain `<img src>` beats a presigned-URL fetch per bubble per viewer. Requires a narrow bucket-policy addition (read-only, scoped to `photos/*`). |
| Cropping | Client-side auto center-crop to square + downscale before upload. No manual crop UI — matches the project's existing "keep it lightweight" bias (see `TagEditor`, `extractTags` fallback). |

## Data model

`lib/types.ts` — one new optional field on `Profile`:

```ts
export interface Profile {
  id: string;
  name: string;
  emoji: string;
  photoUrl?: string;   // new — public S3 object URL. Falls back to emoji when absent.
  gradient: [string, string];
  tagline: string;
  softSkills: string[];
  interests: string[];
}
```

Optional and additive: every existing reader of `Profile` that ignores unknown
fields keeps working unchanged. `SeedPersona extends Profile`, so photos for other
people flow through the existing `/api/people` directory response with no route
changes.

## Storage

One new public-read prefix in the existing `yellow-voice-...` bucket:

- Key shape: `photos/<ownerId>/<timestamp>.jpg` — mirrors the existing
  `audio/<ownerId>/<messageId>.webm` convention (`ownerId` from the session, never
  the request body).
- A fresh key per upload (not a stable per-user key) sidesteps any cache-invalidation
  problem from overwriting an existing object; the previous photo is simply orphaned
  in S3. At this project's scale that's an acceptable trade for not having to think
  about CDN/browser caching at all.
- Bucket policy addition (read-only, scoped to the prefix — nothing else in the
  bucket becomes public):

```json
{
  "Sid": "PublicReadProfilePhotos",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::yellow-voice-563923432327/photos/*"
}
```

## API

New route `app/api/photo/route.ts`, modeled directly on `app/api/audio/route.ts`:

```
POST { fileExt: 'jpg' } -> { ok, putUrl, publicUrl }
```

- `ownerId` resolved via `resolveCaller`/`unauthorized()`, same as the audio route
  — never trusts a client-supplied id.
- Presigns a **PUT only**. No presigned GET route is needed since reads are public;
  `publicUrl` is just the plain `https://<bucket>.s3.<region>.amazonaws.com/<key>`
  URL, returned once so the client can store it on the profile immediately.
- Same fail-soft contract as audio: presigning failure is a normal `{ ok: false }`
  response, never a thrown error — the caller keeps the previous avatar.

## Client upload flow

New helper `lib/photoClient.ts` (client-safe, no AWS SDK — same reasoning as
`lib/audioClient.ts`):

```ts
async function uploadPhoto(ownerId: string, file: File): Promise<string | null>
```

1. Draw `file` to a `<canvas>`, center-crop to square, downscale to 400×400,
   re-encode as JPEG (~0.85 quality).
2. `POST /api/photo` to presign.
3. `PUT` the JPEG blob to `putUrl`.
4. Resolve `publicUrl` on success, `null` on any failure (network, non-2xx, bad
   file type/size). A `null` never blocks or errors the onboarding/settings flow —
   the picker just resets and the existing avatar stays.

Client-side guardrails before upload even starts: `accept="image/*"` on the file
input, reject non-image files and anything over 8MB with an inline message (no
modal), matching the terse inline-hint style already used for tag/name validation
in onboarding.

## UI changes

Both `app/onboarding/page.tsx` (step 3, `.yo-faces` grid) and
`app/settings/page.tsx` (its equivalent avatar grid) get one more tile appended
after the emoji options: an "Upload photo" tile (camera-outline icon) that opens
a hidden `<input type="file" accept="image/*">`.

- While `photoUrl` is set, that tile shows the cropped photo thumbnail instead of
  the icon, with a small "✕" overlay to clear it (revert to the currently-selected
  emoji).
- Picking an emoji after a photo was set clears `photoUrl` implicitly — same "pick
  one" semantics the emoji grid already has, extended by one more option.

## Rendering (`components/Bubble.tsx`)

Single-component change, since every avatar in the app (`BubbleField`,
`ProfileCard`, `MatchNudge`, `Bubble` itself) renders through `Bubble`:

- When `profile.photoUrl` is set: an `<img>` fills the disc
  (`position:absolute; inset:0; object-fit:cover; border-radius:inherit`),
  layered *under* the existing specular-highlight `.y-bub-spec` overlay so it still
  reads as the same glass-sphere bubble. The persona-gradient background
  (`backgroundImage`) stays underneath as the loading/error fallback — visible
  briefly while the image loads, and permanently if the URL 404s, so a broken photo
  degrades to the current look rather than a broken-image icon.
- When absent: unchanged — current emoji + gradient rendering.
- Name-inside-bubble rendering (just fixed) is unaffected either way.

## Out of scope

- Manual crop/zoom UI.
- Photo moderation/review.
- Deleting orphaned S3 objects from replaced photos.
- Changing how `SeedPersona`/demo personas are seeded (they simply have no
  `photoUrl` and render as emoji, same as today).
