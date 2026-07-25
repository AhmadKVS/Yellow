'use client';

/**
 * Client-safe audio transport.
 *
 * Deliberately free of the AWS SDK and `next/headers` so a `'use client'`
 * screen can import it: the connect screen and the chat composer both need the
 * same upload, and a second copy is how the two drift apart.
 *
 * Both helpers are total — every failure resolves to `null` rather than
 * throwing. A null upload means the message simply carries no `s3Key`; a null
 * playback URL means the bubble renders a waveform with playback disabled.
 * Neither is an error state worth showing anyone.
 */

import { getAudioUrl, setAudioUrl } from './audioStore';

/** A recording must not hold up the exchange it belongs to. */
const UPLOAD_BUDGET_MS = 2500;

/** Presigns, then PUTs. Returns the S3 key, or `null` if anything at all fails. */
export async function uploadClip(
  ownerId: string,
  messageId: string,
  blob: Blob,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_BUDGET_MS);
  try {
    const presign = await fetch('/api/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, userId: ownerId }),
      signal: controller.signal,
    });
    if (!presign.ok) return null;

    const data = (await presign.json()) as { putUrl?: string; key?: string };
    if (!data.putUrl || !data.key) return null;

    const put = await fetch(data.putUrl, {
      method: 'PUT',
      body: blob,
      // Must match the content type the URL was signed with.
      headers: { 'Content-Type': 'audio/webm' },
      signal: controller.signal,
    });
    return put.ok ? data.key : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A playable URL for one message, or `null`.
 *
 * The in-session object URL wins when there is one: it plays instantly and
 * costs no round trip. Otherwise the key is presigned once and cached back, so
 * a clip recorded by the other person — or by you before a refresh — still
 * plays.
 */
export async function resolvePlaybackUrl(
  messageId: string,
  s3Key?: string | null,
): Promise<string | null> {
  const local = getAudioUrl(messageId);
  if (local) return local;
  if (!s3Key) return null;

  try {
    const response = await fetch(`/api/audio?key=${encodeURIComponent(s3Key)}`);
    if (!response.ok) return null;

    const data = (await response.json()) as { ok?: boolean; getUrl?: string };
    if (!data.ok || !data.getUrl) return null;

    setAudioUrl(messageId, data.getUrl);
    return data.getUrl;
  } catch {
    return null;
  }
}
