/**
 * The live people directory.
 *
 * Yellow's orbit is made of *real registered users*, read from DynamoDB at
 * runtime. This module is the boundary between the wire shape (a bare
 * `Profile` row someone published at onboarding) and the shape the rest of
 * the app already speaks (`SeedPersona`, which every component consumes).
 *
 * Safe on both sides of the network: pure functions plus `fetch`, no AWS SDK,
 * so a `'use client'` file can import it.
 */

import { isVoiceIntro, type VoiceIntro } from '@/lib/intro';
import { SEED_PERSONAS } from '@/lib/seed';
import type { Profile, SeedPersona } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* shape                                                                      */
/* -------------------------------------------------------------------------- */

export type PeopleSource = 'dynamodb' | 'fallback';

export interface PeopleResult {
  people: SeedPersona[];
  source: PeopleSource;
}

/**
 * What a directory row actually holds. Real users have no scripted `intro`
 * or `cannedReplies` — only the bundled demo personas do — so both are
 * optional here and stood in for by `toPerson`.
 *
 * `voiceIntro` is the real one: three answers the person recorded, written by
 * `POST /api/intro`. It is passed through untouched and is `undefined` until
 * they record, which is a state the UI says out loud rather than papers over.
 */
export interface DirectoryPerson extends Profile {
  intro?: SeedPersona['intro'];
  cannedReplies?: string[];
  voiceIntro?: VoiceIntro;
}

/**
 * The directory lives in its own DynamoDB table (`yellow-users`, PK `userId`),
 * separate from the per-user app-state blobs in `yellow-app`. That keeps the
 * "everyone except me" query a clean `Scan` over small rows instead of one
 * that sweeps a large state blob per account.
 *
 * Defined here rather than in `lib/aws.ts` so the AWS module stays untouched;
 * it reads the same env-var-with-default convention.
 */
export const USERS_TABLE_NAME = process.env.YELLOW_USERS_TABLE ?? 'yellow-users';

/**
 * Where an authenticated identity is published. Auth (Cognito) writes the
 * user's `sub` here — or calls `setDirectoryIdentity` — and the directory
 * picks it up on the next resolve with no other change. Until then every
 * browser falls back to a locally minted UUID.
 */
export const AUTH_ID_STORAGE_KEY = 'yellow:authId';

/** Where the fallback per-browser id is kept. */
export const BROWSER_ID_STORAGE_KEY = 'yellow:directoryId';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)?.trim() || null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — the id simply doesn't survive a reload */
  }
}

/**
 * Point the directory at a real identity. One call is the whole migration
 * from browser-UUID to Cognito `sub`.
 */
export function setDirectoryIdentity(id: string | null | undefined): void {
  const next = typeof id === 'string' ? id.trim() : '';
  if (!next) return;
  writeStored(AUTH_ID_STORAGE_KEY, next);
}

/** Forget a stored identity — used only on a *definitive* signed-out answer. */
export function clearDirectoryIdentity(): void {
  try {
    window.localStorage.removeItem(AUTH_ID_STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The id this browser publishes under, preferring a real authenticated
 * identity and falling back to a stable per-browser UUID. Client-only.
 */
export function resolveDirectoryId(): string {
  const authed = readStored(AUTH_ID_STORAGE_KEY);
  if (authed) return authed;

  const existing = readStored(BROWSER_ID_STORAGE_KEY);
  if (existing) return existing;

  const minted = mintId();
  writeStored(BROWSER_ID_STORAGE_KEY, minted);
  return minted;
}

/**
 * Resolves *the* id this session belongs to: the Cognito `sub` when signed in,
 * the per-browser UUID otherwise. Cached for the page's lifetime — identity
 * only changes across a login/logout navigation — so the many callers that
 * need it cost one request between them.
 *
 * Client-only, and never throws: an unreachable `/api/auth/me` simply means
 * we keep whatever we already had.
 */
let identityPromise: Promise<string> | null = null;

export function resolveIdentity(): Promise<string> {
  if (typeof window === 'undefined') return Promise.resolve('');
  if (!identityPromise) {
    identityPromise = readIdentity().catch(() => resolveDirectoryId());
  }
  return identityPromise;
}

async function readIdentity(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
  try {
    const res = await fetch('/api/auth/me', {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.ok) {
      const body: unknown = await res.json();
      const user = (body as { user?: { sub?: unknown } | null } | null)?.user;
      const sub = typeof user?.sub === 'string' ? user.sub.trim() : '';
      if (sub) {
        setDirectoryIdentity(sub);
        return sub;
      }
      // A definitive "signed out" — drop a stale sub so the next person on
      // this browser doesn't inherit the last one's identity.
      if (user === null) clearDirectoryIdentity();
    }
  } catch {
    // Indeterminate. Don't cache the failure: a later call gets to retry.
    identityPromise = null;
  } finally {
    clearTimeout(timer);
  }
  return resolveDirectoryId();
}

function mintId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `u_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to the cheap id */
  }
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Off by default: the room is meant to be real people. Flip
 * `NEXT_PUBLIC_DEMO_PERSONAS=true` to fold the ten bundled personas back in
 * if the room is empty when it matters.
 */
export const DEMO_PEOPLE_ENABLED = process.env.NEXT_PUBLIC_DEMO_PERSONAS === 'true';

/** Stable identity — handing back the same array keeps `useMemo` honest. */
const NO_PEOPLE: SeedPersona[] = [];

/** What we show when DynamoDB can't be reached: nobody, not fake people. */
export const FALLBACK_PEOPLE: SeedPersona[] = DEMO_PEOPLE_ENABLED
  ? SEED_PERSONAS
  : NO_PEOPLE;

/** Never block a render on the network for longer than this. */
const FETCH_TIMEOUT_MS = 4_000;
const PUBLISH_TIMEOUT_MS = 4_000;
/**
 * Deliberately tight: identity is a local cookie decode, and hydration's own
 * 3.5s deadline has to fit this *plus* the cloud state read behind it.
 */
const IDENTITY_TIMEOUT_MS = 900;

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** A row has to be fully usable before anything renders it. */
export function isDirectoryPerson(value: unknown): value is DirectoryPerson {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    typeof p.emoji === 'string' &&
    (p.photoUrl === undefined || typeof p.photoUrl === 'string') &&
    (p.bio === undefined || typeof p.bio === 'string') &&
    Array.isArray(p.gradient) &&
    p.gradient.length === 2 &&
    typeof p.gradient[0] === 'string' &&
    typeof p.gradient[1] === 'string' &&
    typeof p.tagline === 'string' &&
    isStringArray(p.softSkills) &&
    isStringArray(p.interests)
  );
}

/* -------------------------------------------------------------------------- */
/* wire shape -> app shape                                                    */
/* -------------------------------------------------------------------------- */

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Only a *complete* intro is usable — the connect rail reads all three. */
function isCompleteIntro(value: unknown): value is SeedPersona['intro'] {
  if (typeof value !== 'object' || value === null) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.who === 'string' &&
    typeof i.building === 'string' &&
    typeof i.lookingFor === 'string'
  );
}

/**
 * Fills in the two fields a real signup can't have. Every downstream
 * component (`Bubble`, `ProfileCard`, `Celebration`, the connect rail) is
 * typed against `SeedPersona`, so widening happens here — once — instead of
 * scattering `?.` through five pages and risking a crash on the common case.
 *
 * `voiceIntro` is the one field that is never stood in for. The synthesised
 * `intro` below is a *label* — copy for a card that has to say something — and
 * screens that present recorded answers must branch on `voiceIntro` instead,
 * because attributing invented sentences to a real person was the bug.
 */
export function toPerson(person: DirectoryPerson): SeedPersona {
  const name = person.name.trim();
  const firstName = name.split(/\s+/)[0] || name;
  const tagline = person.tagline.trim();

  return {
    id: person.id,
    name,
    emoji: person.emoji || '🙂',
    photoUrl: person.photoUrl,
    gradient: [person.gradient[0], person.gradient[1]],
    tagline,
    bio: person.bio,
    softSkills: person.softSkills,
    interests: person.interests,
    intro: isCompleteIntro(person.intro)
      ? person.intro
      : {
          who: `I'm ${firstName}. Just joined Yellow.`,
          building: tagline
            ? `Right now I'm working on ${lowerFirst(tagline)}.`
            : `Still working out exactly what I'm building.`,
          lookingFor: `Other builders worth comparing notes with — people who'll be straight with me.`,
        },
    // Empty is meaningful: the chat screen falls through to its generic
    // replies rather than inventing words for a real person.
    cannedReplies: isStringArray(person.cannedReplies) ? person.cannedReplies : [],
    voiceIntro: isVoiceIntro(person.voiceIntro) ? person.voiceIntro : undefined,
  };
}

/**
 * Validates a whole payload. Returns `null` — meaning "use the fallback" —
 * rather than throwing, and rather than half-rendering a malformed list.
 */
export function normalizePeople(raw: unknown): SeedPersona[] | null {
  if (!Array.isArray(raw)) return null;

  const out: SeedPersona[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isDirectoryPerson(item)) return null;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(toPerson(item));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* io — every path returns, none throw                                        */
/* -------------------------------------------------------------------------- */

function fallback(): PeopleResult {
  return { people: FALLBACK_PEOPLE, source: 'fallback' };
}

/**
 * Reads the directory. Times out at 4s and degrades to `FALLBACK_PEOPLE`
 * (empty, unless the demo flag is on) on timeout, network error, bad status
 * or malformed body. Never throws.
 */
export async function fetchPeople(
  options: { excludeId?: string | null; signal?: AbortSignal } = {},
): Promise<PeopleResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const query = options.excludeId
      ? `?excludeId=${encodeURIComponent(options.excludeId)}`
      : '';
    const res = await fetch(`/api/people${query}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return fallback();

    const body: unknown = await res.json();
    const people = normalizePeople((body as { people?: unknown } | null)?.people);
    if (!people) return fallback();

    const source: PeopleSource =
      (body as { source?: unknown } | null)?.source === 'dynamodb'
        ? 'dynamodb'
        : 'fallback';
    return { people, source };
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Publishes a profile so other people can discover it. The id is injectable —
 * it defaults to this browser's directory id today and becomes the Cognito
 * `sub` the moment auth writes one, with no change here.
 *
 * Best-effort by design: onboarding must complete whether or not AWS is
 * reachable, so the result is a boolean and failure is silent.
 */
export async function publishProfile(
  profile: Profile,
  id: string = resolveDirectoryId(),
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
  try {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, profile: { ...profile, id } }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (body as { ok?: unknown } | null)?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
