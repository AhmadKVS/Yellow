import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET_NAME, s3 } from '@/lib/aws';
import { resolveCaller, unauthorized } from '@/lib/session';

export const runtime = 'nodejs';

/** Plenty of time for a client that's about to PUT a few hundred KB. */
const EXPIRES_IN = 60 * 60;

/** Owner ids are Cognito subs, so the colon of an identity-pool id is allowed too. */
const SAFE_OWNER = /^[A-Za-z0-9._:-]{1,128}$/;

const CONTENT_TYPE = 'image/jpeg';

const REGION = process.env.AWS_REGION ?? 'us-east-2';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST { userId? } -> { ok, putUrl, publicUrl, key }
 *
 * Photos live under the public-read `photos/` prefix (see the bucket policy
 * in the profile-photos design doc) — unlike voice clips, every match sees
 * this image passively on every page load, so it is served as a plain URL
 * rather than a presigned read fetched per viewer per bubble. Only the PUT
 * needs presigning.
 *
 * A fresh key per upload (timestamped, not a stable per-user key) sidesteps
 * any cache-invalidation problem from overwriting an existing object; the
 * previous photo is simply orphaned in S3.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { userId?: unknown }
      | null;

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

    const key = `photos/${ownerId}/${Date.now()}.jpg`;

    const putUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: CONTENT_TYPE }),
      { expiresIn: EXPIRES_IN },
    );

    const publicUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${key}`;

    return Response.json({ ok: true, putUrl, publicUrl, key }, { headers: NO_STORE });
  } catch (error) {
    console.error('[api/photo] could not presign', error);
    return Response.json(
      { ok: false, error: 'Could not create an upload link for this photo.' },
      { status: 500 },
    );
  }
}
