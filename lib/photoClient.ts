'use client';

/**
 * Client-safe photo upload. Deliberately free of the AWS SDK — same reasoning
 * as `lib/audioClient.ts` — so onboarding and settings can both import it.
 *
 * Total, like the audio helper: every failure resolves to `null` rather than
 * throwing. A `null` never blocks or errors the surrounding form; the picker
 * just resets and the previous avatar (emoji or photo) stays.
 */

const UPLOAD_BUDGET_MS = 4000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const OUTPUT_SIZE = 400;
const OUTPUT_QUALITY = 0.85;

export type PhotoRejection = 'type' | 'size';

/** Cheap pre-flight check the caller can show inline before even touching the network. */
export function rejectPhoto(file: File): PhotoRejection | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_SOURCE_BYTES) return 'size';
  return null;
}

/** Center-crop `file` to a square and downscale it to a bubble-sized JPEG. */
function cropToSquareJpeg(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', OUTPUT_QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Crops, presigns, then PUTs. Returns the public photo URL, or `null` if anything fails. */
export async function uploadPhoto(ownerId: string, file: File): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_BUDGET_MS);
  try {
    const jpeg = await cropToSquareJpeg(file);
    if (!jpeg) return null;

    const presign = await fetch('/api/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: ownerId }),
      signal: controller.signal,
    });
    if (!presign.ok) return null;

    const data = (await presign.json()) as { putUrl?: string; publicUrl?: string };
    if (!data.putUrl || !data.publicUrl) return null;

    const put = await fetch(data.putUrl, {
      method: 'PUT',
      body: jpeg,
      headers: { 'Content-Type': 'image/jpeg' },
      signal: controller.signal,
    });
    return put.ok ? data.publicUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
