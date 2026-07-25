/**
 * Server-only. Who is calling a route.
 *
 * IMPORTANT: never import this from a `'use client'` file — it pulls in
 * `lib/cognito.ts`, which reads `COGNITO_CLIENT_SECRET` and `next/headers`.
 *
 * Every route that touches shared data resolves its caller through this one
 * function. Duplicating the rule per route is exactly how one of them ends up
 * trusting a body field and handing one account another account's thread.
 */

import { getSession, isCognitoConfigured } from './cognito';

/**
 * The session `sub` when there is one; otherwise the caller's own claim, but
 * *only* while Cognito is unconfigured.
 *
 * That second branch is the deliberate fail-open this app is built on: local
 * development has no pool, and locking an app whose auth doesn't work is
 * unrecoverable. With Cognito configured the claim is ignored entirely and an
 * unauthenticated caller resolves to `null`, which every route turns into a
 * 401 — that is what stops one account reading another's messages.
 */
export async function resolveCaller(
  fallbackId?: string | null,
): Promise<string | null> {
  const session = await getSession();
  if (session?.sub) return session.sub;

  if (isCognitoConfigured()) return null;

  const claimed = typeof fallbackId === 'string' ? fallbackId.trim() : '';
  return claimed || null;
}

/** The 401 body every pair route returns when `resolveCaller` gives `null`. */
export function unauthorized(): Response {
  return Response.json(
    { ok: false, reason: 'unauthenticated', error: 'Sign in to do that.' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}
