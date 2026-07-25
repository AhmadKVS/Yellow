import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET_NAME, s3 } from '@/lib/aws';

export const runtime = 'nodejs';

/** One hour is plenty: the client uploads immediately and plays from a local blob URL. */
const EXPIRES_IN = 60 * 60;

/** Message ids become S3 key segments, so keep them boring. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

const CONTENT_TYPE = 'audio/webm';

/**
 * POST { messageId } -> { putUrl, getUrl, key }
 *
 * Presigning never touches S3, so this can succeed even while the bucket or
 * the IAM policy is still being set up — the PUT is what will fail. Either
 * way the client treats upload as best-effort and keeps its local object URL,
 * so a failure here must never be fatal.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { messageId?: unknown } | null;
    const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : '';

    if (!SAFE_ID.test(messageId)) {
      return Response.json(
        { ok: false, error: 'messageId must be 1-128 characters of A-Z, a-z, 0-9, dot, dash or underscore.' },
        { status: 400 },
      );
    }

    const key = `audio/me/${messageId}.webm`;

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

    return Response.json({ ok: true, putUrl, getUrl, key });
  } catch (error) {
    console.error('[api/audio] could not presign', error);
    return Response.json(
      { ok: false, error: 'Could not create an upload link for this recording.' },
      { status: 500 },
    );
  }
}
