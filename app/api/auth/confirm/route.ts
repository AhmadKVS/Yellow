import {
  EMAIL_PATTERN,
  authErrorResponse,
  badRequest,
  confirmSignUp,
  field,
  friendlyAuthError,
  isCognitoConfigured,
  normalizeEmail,
  notConfiguredResponse,
  readJsonBody,
  resendCode,
} from '@/lib/cognito';

/**
 * POST { email, code }              -> { ok, confirmed }
 * POST { email, action: 'resend' }  -> { ok, resent }
 */
export async function POST(req: Request) {
  try {
    if (!isCognitoConfigured()) return notConfiguredResponse();

    const body = await readJsonBody(req);
    const email = normalizeEmail(field(body, 'email'));
    const action = field(body, 'action');
    const code = field(body, 'code').replace(/\D/g, '');

    if (!EMAIL_PATTERN.test(email)) {
      return badRequest('That email address looks incomplete.', 'bad_email');
    }

    if (action === 'resend') {
      await resendCode(email);
      return Response.json({ ok: true, resent: true });
    }

    if (code.length !== 6) {
      return badRequest('Enter the six digits from the email.', 'bad_code');
    }

    try {
      await confirmSignUp(email, code);
    } catch (err) {
      // Confirming twice is a normal thing for a person to do — the second
      // attempt is a success, not an error.
      if (friendlyAuthError(err).code === 'already_confirmed') {
        return Response.json({
          ok: true,
          confirmed: true,
          alreadyConfirmed: true,
        });
      }
      throw err;
    }

    return Response.json({ ok: true, confirmed: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
