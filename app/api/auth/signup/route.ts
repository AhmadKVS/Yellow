import {
  EMAIL_PATTERN,
  authErrorResponse,
  badRequest,
  field,
  isCognitoConfigured,
  normalizeEmail,
  notConfiguredResponse,
  readJsonBody,
  signUp,
} from '@/lib/cognito';

/** POST { email, password, name } -> { ok, needsConfirmation, email } */
export async function POST(req: Request) {
  try {
    if (!isCognitoConfigured()) return notConfiguredResponse();

    const body = await readJsonBody(req);
    const email = normalizeEmail(field(body, 'email'));
    const password = field(body, 'password');
    const name = field(body, 'name').trim().slice(0, 60);

    if (!name) {
      return badRequest('Add a name so people know who they met.', 'no_name');
    }
    if (!EMAIL_PATTERN.test(email)) {
      return badRequest('That email address looks incomplete.', 'bad_email');
    }
    if (password.length < 8) {
      return badRequest(
        'Passwords need at least 8 characters.',
        'weak_password',
      );
    }

    const { userConfirmed } = await signUp(email, password, name);

    return Response.json({
      ok: true,
      email,
      needsConfirmation: !userConfirmed,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
