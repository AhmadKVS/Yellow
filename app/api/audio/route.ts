import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET_NAME, s3 } from '@/lib/aws';
import { resolveCaller, unauthorized } from '@/lib/session';

export const runtime = 'nodejs';

/** One hour is plenty: the client uploads immediately and plays from a local blob URL. */
const EXPIRES_IN = 60 * 60;

/** Message ids become S3 key segments, so keep them boring. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Owner ids are Cognito subs, so the colon of an identity-pool id is allowed too. */
const SAFE_OWNER = /^[A-Za-z0-9._:-]{1,128}$/;

/** A key this route is willing to presign. Anything else could be walked elsewhere. */
const AUDIO_KEY = /^audio\/[A-Za-z0-9._:-]{1,128}\/[A-Za-z0-9._-]{1,128}\.webm$/;

const CONTENT_TYPE = 'audio/webm';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST { messageId, userId? } -> { ok, putUrl, getUrl, key }
 *
 * The key is `audio/<ownerId>/<messageId>.webm`, and `ownerId` comes from the
 * session — never straight from the body. It used to be a literal `me/`, which
 * put every account in one prefix and let them overwrite each other.
 *
 * Presigning never touches S3, so this can succeed even while the bucket or
 * the IAM policy is still being set up — the PUT is what will fail. Either
 * way the client treats upload as best-effort and keeps its local object URL,
 * so a failure here must never be fatal.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { messageId?: unknown; userId?: unknown }
      | null;
    const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : '';

    if (!SAFE_ID.test(messageId)) {
      return Response.json(
        { ok: false, error: 'messageId must be 1-128 characters of A-Z, a-z, 0-9, dot, dash or underscore.' },
        { status: 400 },
      );
    }

    const ownerId = await resolveCaller(
      typeof body?.userId === 'string' ? body.userId : null,
    );
    if (!ownerId) return unauthorized();

    if (!SAFE_OWNER.test(ownerId)) {
      return Response.json(
        { ok: false, error: 'That account id cannot be used as a storage path.' },
        { status: 400 },
      );
    }

    const key = `audio/${ownerId}/${messageId}.webm`;

    const [putUrl, getUrl] = await Promise.all([
      getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: CONTENT_TYPE }),
        { expiresIn: EXPIRES_IN },
      ),
      getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }), {
        expiresIn: EXPIRES_IN,
      }),
    ]);

    return Response.json({ ok: true, putUrl, getUrl, key }, { headers: NO_STORE });
  } catch (error) {
    console.error('[api/audio] could not presign', error);
    return Response.json(
      { ok: false, error: 'Could not create an upload link for this recording.' },
      { status: 500 },
    );
  }
}

/**
 * GET ?key=<s3key> -> { ok, getUrl }
 *
 * Without this the uploader is the only person who ever holds a `getUrl`, so
 * the other side of a thread physically cannot hear a clip.
 *
 * Read access is deliberately not scoped per pair: a key is an unguessable id
 * handed out only inside a thread you belong to. Every failure — including a
 * rejected key — answers 200 with `{ ok: false }`, because playback degrading
 * to a silent waveform is the designed behaviour, not an error surface.
 */
export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('key')?.trim() ?? '';
    if (!AUDIO_KEY.test(key)) {
      return Response.json({ ok: false }, { headers: NO_STORE });
    }

    const getUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: EXPIRES_IN },
    );

    return Response.json({ ok: true, getUrl }, { headers: NO_STORE });
  } catch (error) {
    console.error('[api/audio] could not presign a read', error);
    return Response.json({ ok: false }, { headers: NO_STORE });
  }
}
