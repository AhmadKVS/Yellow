/**
 * The voice intro: three recorded answers, recorded once and reused.
 *
 * Yellow's whole premise is that both people go first, so what the other side
 * hears has to be something you actually said. Before this module the connect
 * screen rendered strings synthesised from a tagline as if they were a
 * recording — waveform, duration and all. Nothing here invents an answer: an
 * intro either exists on your directory row or it doesn't, and the absence is
 * something the UI is expected to say out loud.
 *
 * Pure and client-safe — no AWS SDK, no `next/headers` — so a `'use client'`
 * page can import it. The reads and writes behind these helpers live in
 * `app/api/intro/route.ts`.
 */

/* -------------------------------------------------------------------------- */
/* shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface VoiceClip {
  /** Where the audio lives. Absent when the upload failed or the mic was denied. */
  s3Key?: string;
  durationSec: number;
  waveSeed: number;
  /** Typed fallback when there is no audio, or a transcript alongside it. */
  text?: string;
  /**
   * TRANSIENT. Presigned server-side on every read and never persisted —
   * storing it would bake a link that expires in an hour into a row that
   * outlives it.
   */
  url?: string;
}

export interface VoiceIntro {
  who: VoiceClip;
  building: VoiceClip;
  lookingFor: VoiceClip;
  recordedAt: number;
}

export const INTRO_KEYS = ['who', 'building', 'lookingFor'] as const;

export type IntroKey = (typeof INTRO_KEYS)[number];

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A clip needs a waveform to draw and *something* to deliver. Neither audio
 * nor text means an empty bubble on the connect screen, which reads as a
 * broken recording rather than as the honest "nothing here yet" it is.
 */
export function isVoiceClip(value: unknown): value is VoiceClip {
  if (typeof value !== 'object' || value === null) return false;
  const clip = value as Record<string, unknown>;

  if (!isFiniteNumber(clip.durationSec) || !isFiniteNumber(clip.waveSeed)) return false;
  if (clip.s3Key !== undefined && typeof clip.s3Key !== 'string') return false;
  if (clip.text !== undefined && typeof clip.text !== 'string') return false;

  return Boolean(clip.s3Key?.trim() || clip.text?.trim());
}

/** All three answers, or nothing — the connect rail reads every one of them. */
export function isVoiceIntro(value: unknown): value is VoiceIntro {
  if (typeof value !== 'object' || value === null) return false;
  const intro = value as Record<string, unknown>;

  if (!isFiniteNumber(intro.recordedAt)) return false;
  return INTRO_KEYS.every((key) => isVoiceClip(intro[key]));
}

/* -------------------------------------------------------------------------- */
/* io — every path returns, none throw                                        */
/* -------------------------------------------------------------------------- */

const FETCH_TIMEOUT_MS = 4_000;
const SAVE_TIMEOUT_MS = 4_000;

/**
 * Someone's recorded intro, each clip carrying a freshly presigned `url`.
 * `null` means "they haven't recorded" *and* "we couldn't find out" — both
 * degrade to the same honest empty state, so the caller needs no branch.
 */
export async function fetchIntro(userId: string): Promise<VoiceIntro | null> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`/api/intro?userId=${encodeURIComponent(id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const body: unknown = await res.json();
    const intro = (body as { intro?: unknown } | null)?.intro;
    return isVoiceIntro(intro) ? intro : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Saves my intro onto my own directory row. `userId` is only a claim: the
 * server resolves the real writer from the session and ignores it entirely
 * once Cognito is configured.
 *
 * Best-effort like `publishProfile` — sending an intro must complete whether
 * or not the save lands, so the result is a boolean and failure is silent.
 */
export async function saveIntro(intro: VoiceIntro, userId?: string): Promise<boolean> {
  if (!isVoiceIntro(intro)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);

  try {
    const res = await fetch('/api/intro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro, userId }),
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
