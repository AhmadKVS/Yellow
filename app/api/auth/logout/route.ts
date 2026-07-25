import { clearSessionCookies } from '@/lib/cognito';

/**
 * POST -> { ok: true }
 *
 * Deliberately succeeds whether or not Cognito is configured: dropping local
 * cookies never needs the pool, and a logout that can 503 is a trap.
 */
export async function POST() {
  try {
    await clearSessionCookies();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true });
  }
}
