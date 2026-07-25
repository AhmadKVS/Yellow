/**
 * Voice intros: read anyone's, write only your own.
 *
 * Storage is one optional `voiceIntro` attribute on the person's `yellow-users`
 * row, beside the `profile` the directory scan reads. The write is an
 * `UpdateCommand` touching that single attribute — a `PutCommand` would replace
 * the item and take `profile` with it, erasing the author from everyone else's
 * orbit.
 *
 * Fail-soft contract: `GET` always answers 200. A missing row, a malformed
 * intro, a dead presign or an unreachable DynamoDB all resolve to
 * `{ intro: null }`, which the connect screen already renders as "they haven't
 * recorded yet". Only a genuine authorization failure is a non-200.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET_NAME, ddb, s3 } from '@/lib/aws';
import { isVoiceIntro, type VoiceClip, type VoiceIntro } from '@/lib/intro';
import { USERS_TABLE_NAME } from '@/lib/people';
import { resolveCaller, unauthorized } from '@/lib/session';

export const runtime = 'nodejs';

/** Hard ceiling on the DynamoDB call — a hung read must not hang the screen. */
const DDB_TIMEOUT_MS = 3_000;

/** Long enough to open the connect screen and listen without a refetch. */
const PLAYBACK_EXPIRES_IN = 60 * 60;

function json(body: unknown): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

/* -------------------------------------------------------------------------- */
/* playback links                                                             */
/* -------------------------------------------------------------------------- */

async function withPlaybackUrl(clip: VoiceClip): Promise<VoiceClip> {
  const key = clip.s3Key?.trim();
  if (!key) return clip;

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: PLAYBACK_EXPIRES_IN },
    );
    return { ...clip, url };
  } catch {
    // Waveform still renders, playback is disabled. Never an error surface.
    return clip;
  }
}

async function withPlaybackUrls(intro: VoiceIntro): Promise<VoiceIntro> {
  const [who, building, lookingFor] = await Promise.all([
    withPlaybackUrl(intro.who),
    withPlaybackUrl(intro.building),
    withPlaybackUrl(intro.lookingFor),
  ]);
  return { ...intro, who, building, lookingFor };
}

/* -------------------------------------------------------------------------- */
/* GET /api/intro?userId=<id>                                                 */
/* -------------------------------------------------------------------------- */

export async function GET(req: Request): Promise<Response> {
  let userId = '';
  try {
    userId = new URL(req.url).searchParams.get('userId')?.trim() || '';
  } catch {
    /* a malformed URL is just another way of asking about nobody */
  }
  if (!userId) return json({ intro: null });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);

  try {
    const result = await ddb.send(
      new GetCommand({ TableName: USERS_TABLE_NAME, Key: { userId } }),
      { abortSignal: controller.signal },
    );

    const stored: unknown = result.Item?.voiceIntro;
    if (!isVoiceIntro(stored)) return json({ intro: null });

    return json({ intro: await withPlaybackUrls(stored) });
  } catch {
    return json({ intro: null });
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/intro — save my own intro                                        */
/* -------------------------------------------------------------------------- */

/**
 * Drops `url` — it is presigned per read and would be dead long before the row
 * is read again — and omits every absent field, because the document client
 * rejects an explicit `undefined`.
 */
function forStorage(clip: VoiceClip): VoiceClip {
  const stored: VoiceClip = {
    durationSec: clip.durationSec,
    waveSeed: clip.waveSeed,
  };
  const key = clip.s3Key?.trim();
  const text = clip.text?.trim();
  if (key) stored.s3Key = key;
  if (text) stored.text = text;
  return stored;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { intro?: unknown; userId?: unknown }
    | null;

  const claimed = typeof body?.userId === 'string' ? body.userId : null;
  const caller = await resolveCaller(claimed);
  if (!caller) return unauthorized();

  const intro = body?.intro;
  if (!isVoiceIntro(intro)) return json({ ok: false, reason: 'invalid' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { userId: caller },
        UpdateExpression: 'SET voiceIntro = :intro, updatedAt = :now',
        ExpressionAttributeValues: {
          ':intro': {
            who: forStorage(intro.who),
            building: forStorage(intro.building),
            lookingFor: forStorage(intro.lookingFor),
            recordedAt: intro.recordedAt,
          },
          ':now': Date.now(),
        },
      }),
      { abortSignal: controller.signal },
    );

    return json({ ok: true });
  } catch {
    // The recording is still in the sender's hands; the send itself goes on.
    return json({ ok: false, reason: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
