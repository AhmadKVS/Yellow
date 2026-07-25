import { getSession, isAuthEnforced, isCognitoConfigured } from '@/lib/cognito';

/**
 * GET -> { user, configured, enforced }
 *
 * This is the one route that never returns 503. It's the probe the login and
 * signup screens use to decide whether auth exists at all, and it's the route
 * any future gate would call — so an unconfigured or expired session has to
 * read as a plain, boring `{ user: null }` at 200 rather than an error.
 */
export async function GET() {
  try {
    const configured = isCognitoConfigured();
    const user = configured ? await getSession() : null;

    return Response.json({
      user,
      configured,
      enforced: isAuthEnforced(),
    });
  } catch {
    return Response.json({ user: null, configured: false, enforced: false });
  }
}
