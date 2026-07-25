/**
 * POST /api/pair/intro -> { ok, pair: PairView | null, connected: boolean }
 *
 * The gate. Marks *one* side's intro as sent and answers with the truth about
 * the pair — which is the entire fix for the reported bug: the connect screen
 * used to tell its own store that the other person had replied, so the
 * celebration fired for someone who had sent nothing.
 *
 * `connected` is true only when the row now carries `connectedAt`, which
 * `markIntroSent` stamps only when both sides are in. A client cannot talk
 * itself into it.
 */

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '@/lib/aws';
import { markIntroSent } from '@/lib/pairServer';
import { toPairView, type PairMessage } from '@/lib/pair';
import { INTRO_KEYS, isVoiceIntro, type VoiceIntro } from '@/lib/intro';
import { USERS_TABLE_NAME } from '@/lib/people';
import { resolveCaller, unauthorized } from '@/lib/session';

const DDB_TIMEOUT_MS = 3_000;

/** Spacing between seeded notes, so the thread reads in question order. */
const SEED_STEP_MS = 1_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** One person's recorded intro, straight off their directory row. */
async function readVoiceIntro(userId: string): Promise<VoiceIntro | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);
  try {
    const result = await ddb.send(
      new GetCommand({ TableName: USERS_TABLE_NAME, Key: { userId } }),
      { abortSignal: controller.signal },
    );
    const intro = result.Item?.voiceIntro;
    return isVoiceIntro(intro) ? intro : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Both people's three answers, as thread messages.
 *
 * Ids are deterministic (`intro-<ownerId>-<key>`) so a retry — or both sides
 * racing the unlock — cannot double-post the exchange. Ordered question by
 * question rather than person by person, because that is how the connect
 * screen presented it and how the conversation actually reads.
 *
 * A missing intro contributes nothing rather than blocking the unlock: someone
 * whose upload failed still gets to connect, they just have less to show.
 */
function seedMessages(
  base: number,
  ...sides: { ownerId: string; intro: VoiceIntro | null }[]
): PairMessage[] {
  const out: PairMessage[] = [];

  INTRO_KEYS.forEach((key, question) => {
    sides.forEach(({ ownerId, intro }, side) => {
      const clip = intro?.[key];
      if (!clip) return;
      out.push({
        id: `intro-${ownerId}-${key}`,
        senderId: ownerId,
        kind: 'voice',
        at: base + question * sides.length * SEED_STEP_MS + side * SEED_STEP_MS,
        ...(clip.text ? { text: clip.text } : {}),
        durationSec: clip.durationSec,
        waveSeed: clip.waveSeed,
        ...(clip.s3Key ? { s3Key: clip.s3Key } : {}),
      });
    });
  });

  return out;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const claimed = typeof body?.userId === 'string' ? body.userId : null;
  const me = await resolveCaller(claimed);
  if (!me) return unauthorized();

  const them = typeof body?.with === 'string' ? body.with.trim() : '';
  if (!them || them === me) {
    return json({ ok: false, reason: 'invalid', pair: null, connected: false });
  }

  const { record } = await markIntroSent(me, them, async () => {
    // Only paid on the one request that actually unlocks the pair.
    const [mine, theirs] = await Promise.all([readVoiceIntro(me), readVoiceIntro(them)]);
    const base = Date.now();
    return seedMessages(
      base,
      { ownerId: me, intro: mine },
      { ownerId: them, intro: theirs },
    );
  });

  if (!record) {
    return json({ ok: false, reason: 'unavailable', pair: null, connected: false });
  }

  const pair = toPairView(record, me);
  return json({ ok: true, pair, connected: Boolean(pair?.connectedAt) });
}
