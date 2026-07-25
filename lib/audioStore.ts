'use client';

/**
 * In-session audio cache.
 *
 * Recorded voice notes live here as object URLs keyed by message id, so a
 * bubble can play back instantly without a network round trip. Nothing here
 * is persisted: `localStorage` holds only the `Message` metadata
 * (`durationSec`, `waveSeed`, `s3Key`) — audio blobs are orders of magnitude
 * too large and would blow the quota, taking every other persisted key with
 * them. After a refresh a bubble finds no URL here and degrades to a
 * playback-disabled waveform, which is the intended behaviour.
 */

const objectUrls = new Map<string, string>();

function revokeUrl(url: string): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // A URL can only be revoked once; a second attempt is not worth surfacing.
  }
}

/** Registers an object URL for `messageId`, revoking any URL it replaces. */
export function setAudioUrl(messageId: string, url: string): void {
  const previous = objectUrls.get(messageId);
  if (previous && previous !== url) revokeUrl(previous);
  objectUrls.set(messageId, url);
}

/** Creates an object URL for `blob`, registers it, and returns it. */
export function putAudioBlob(messageId: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  setAudioUrl(messageId, url);
  return url;
}

/** The object URL for `messageId`, or `undefined` if this session never had it. */
export function getAudioUrl(messageId: string): string | undefined {
  return objectUrls.get(messageId);
}

export function hasAudio(messageId: string): boolean {
  return objectUrls.has(messageId);
}

/** Drops and revokes a single entry. */
export function revokeAudio(messageId: string): void {
  const url = objectUrls.get(messageId);
  if (!url) return;
  objectUrls.delete(messageId);
  revokeUrl(url);
}

/** Drops and revokes every entry. Call this from any "reset the demo" path. */
export function clearAll(): void {
  for (const url of objectUrls.values()) revokeUrl(url);
  objectUrls.clear();
}

/** How many clips this session is holding. Handy for debugging. */
export function audioCount(): number {
  return objectUrls.size;
}
