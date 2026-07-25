import {
  EMAIL_PATTERN,
  authErrorResponse,
  badRequest,
  field,
  friendlyAuthError,
  isCognitoConfigured,
  normalizeEmail,
  notConfiguredResponse,
  readJsonBody,
  resendCode,
  setSessionCookies,
  signIn,
} from '@/lib/cognito';

/**
 * POST { email, password } -> { ok, user }
 *
 * An unconfirmed account is not treated as a failure: it comes back with
 * `needsConfirmation` so the UI can slide into the code step instead of
 * dead-ending on an error.
 */
export async function POST(req: Request) {
  try {
    if (!isCognitoConfigured()) return notConfiguredResponse();

    const body = await readJsonBody(req);
    const email = normalizeEmail(field(body, 'email'));
    const password = field(body, 'password');

    if (!EMAIL_PATTERN.test(email)) {
      return badRequest('That email address looks incomplete.', 'bad_email');
    }
    if (!password) {
      return badRequest('Enter your password.', 'no_password');
    }

    let tokens;
    try {
      tokens = await signIn(email, password);
    } catch (err) {
      const info = friendlyAuthError(err);
      if (info.needsConfirmation) {
        // Send a fresh code so the confirm step has something to accept.
        // Best effort — a rate limit here shouldn't block the redirect.
        let codeSent = false;
        try {
          await resendCode(email);
          codeSent = true;
        } catch {
          codeSent = false;
        }

        return Response.json(
          {
            ok: false,
            reason: info.code,
            needsConfirmation: true,
            email,
            codeSent,
            error: codeSent
              ? 'Confirm your email to finish signing in. We just sent a fresh code.'
              : 'Confirm your email to finish signing in.',
          },
          { status: 403 },
        );
      }
      throw err;
    }

    const user = await setSessionCookies(tokens);

    return Response.json({ ok: true, user });
  } catch (err) {
    return authErrorResponse(err);
  }
}
