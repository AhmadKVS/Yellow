/**
 * POST /api/pair/message -> { ok, pair: PairView | null }
 *
 * One message onto the shared thread. The gate is enforced here, not in the
 * UI: a pair with no `connectedAt` rejects the write, so hiding the composer
 * is a courtesy rather than the actual rule.
 *
 * `senderId` and `at` are stamped server-side. Taking either from the body
 * would let a caller post as the other person, or backdate a message to the
 * top of someone's thread.
 */

import { appendMessages, readPair } from '@/lib/pairServer';
import { toPairView, type PairMessage } from '@/lib/pair';
import { resolveCaller, unauthorized } from '@/lib/session';

/** Message ids become S3 key segments elsewhere, so keep them boring. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_TEXT = 4_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const claimed = typeof body?.userId === 'string' ? body.userId : null;
  const me = await resolveCaller(claimed);
  if (!me) return unauthorized();

  const them = typeof body?.with === 'string' ? body.with.trim() : '';
  if (!them) return json({ ok: false, reason: 'invalid', pair: null });

  const raw = (body?.message ?? null) as Record<string, unknown> | null;
  if (!raw) return json({ ok: false, reason: 'invalid', pair: null });

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const kind = raw.kind === 'voice' ? 'voice' : 'text';
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT) : '';

  if (!SAFE_ID.test(id)) return json({ ok: false, reason: 'invalid', pair: null });
  // A text message with no text, or a voice note with neither audio nor a
  // typed fallback, would render as an empty bubble on both sides.
  if (kind === 'text' && !text) return json({ ok: false, reason: 'empty', pair: null });

  const existing = await readPair(me, them);
  const view = existing ? toPairView(existing, me) : null;

  if (!view) return json({ ok: false, reason: 'not_found', pair: null });
  if (!view.connectedAt) {
    return json({ ok: false, reason: 'locked', pair: view });
  }

  // An id that's already on the row means a retry, not a second message.
  if (view.messages.some((m) => m.id === id)) {
    return json({ ok: true, pair: view });
  }

  const message: PairMessage = {
    id,
    senderId: me,
    kind,
    at: Date.now(),
    ...(text ? { text } : {}),
    ...(typeof raw.durationSec === 'number' ? { durationSec: raw.durationSec } : {}),
    ...(typeof raw.waveSeed === 'number' ? { waveSeed: raw.waveSeed } : {}),
    ...(typeof raw.s3Key === 'string' && raw.s3Key ? { s3Key: raw.s3Key } : {}),
  };

  const updated = await appendMessages(me, them, [message]);
  if (!updated) {
    // The write failed. Say so plainly rather than echoing a thread that
    // doesn't contain the message — the client shows a "not sent" marker.
    return json({ ok: false, reason: 'unavailable', pair: view });
  }

  return json({ ok: true, pair: toPairView(updated, me) });
}
