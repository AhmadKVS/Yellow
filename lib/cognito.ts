/**
 * Server-only AWS Cognito helper.
 *
 * IMPORTANT: never import this from a `'use client'` file. It reads
 * `COGNITO_CLIENT_SECRET` and imports `next/headers`, so a client import is
 * both a secret leak and a build error.
 *
 * Design rule for this module: auth is *additive*. If Cognito isn't
 * configured, nothing here throws at import time and nothing crashes the
 * process — the call sites get a single well-typed `AuthNotConfiguredError`
 * they can turn into a clean 503, and the rest of the app carries on as if
 * auth didn't exist.
 */

import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const ID_TOKEN_COOKIE = 'yellow_id_token';
export const REFRESH_TOKEN_COOKIE = 'yellow_refresh_token';

/** Cognito's default id-token lifetime; only used when the API omits it. */
const ID_TOKEN_FALLBACK_MAX_AGE = 60 * 60;
/** Cognito's default refresh-token lifetime. */
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

/** Keep a hung Cognito from turning into a hung request during a demo. */
const CONNECT_TIMEOUT_MS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** True only when the pool id, client id, and client secret are all present. */
export function isCognitoConfigured(): boolean {
  return Boolean(
    env('COGNITO_USER_POOL_ID') &&
      env('COGNITO_CLIENT_ID') &&
      env('COGNITO_CLIENT_SECRET'),
  );
}

/**
 * Whether signed-out visitors should actually be walled out.
 *
 * Deliberately requires *both* the explicit opt-in flag and a working
 * configuration: flipping the flag on a half-configured pool must never be
 * able to lock everyone out of the app.
 */
export function isAuthEnforced(): boolean {
  return (
    process.env.NEXT_PUBLIC_AUTH_REQUIRED === 'true' && isCognitoConfigured()
  );
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Thrown by every wrapper below when Cognito isn't configured. */
export class AuthNotConfiguredError extends Error {
  readonly code = 'not_configured' as const;
  constructor() {
    super('Cognito is not configured');
    this.name = 'AuthNotConfiguredError';
  }
}

/** InitiateAuth came back with a challenge instead of tokens (MFA, forced
 *  password reset, …). Out of scope for a custom hackathon login UI. */
export class AuthChallengeError extends Error {
  readonly challenge: string;
  constructor(challenge?: string) {
    super(`Unsupported auth challenge: ${challenge ?? 'UNKNOWN'}`);
    this.name = 'AuthChallengeError';
    this.challenge = challenge ?? 'UNKNOWN';
  }
}

function requireConfig(): void {
  if (!isCognitoConfigured()) throw new AuthNotConfiguredError();
}

/* ------------------------------------------------------------------ */
/* Client + SECRET_HASH                                                */
/* ------------------------------------------------------------------ */

let cached: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  requireConfig();
  if (!cached) {
    cached = new CognitoIdentityProviderClient({
      region: env('AWS_REGION') || 'us-east-2',
      maxAttempts: 2,
      requestHandler: {
        connectionTimeout: CONNECT_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      },
    });
  }
  return cached;
}

/**
 * Every Cognito call that takes a username needs this when the app client
 * has a secret (a "traditional web application" client does).
 *
 *   Base64( HMAC_SHA256( key = clientSecret, message = username + clientId ) )
 *
 * Omitting it fails with `NotAuthorizedException: Unable to verify secret
 * hash for client …`, which gives no hint at the real cause. The message
 * must use the *exact* username string sent as `Username` — which is why
 * everything below normalizes the email first.
 */
export function secretHash(username: string): string {
  const clientId = env('COGNITO_CLIENT_ID');
  const clientSecret = env('COGNITO_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new AuthNotConfiguredError();
  return createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
}

/** Cognito usernames are case-sensitive; SECRET_HASH is computed over the
 *  same string, so both sides have to agree on one canonical form. */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Cognito wrappers                                                    */
/* ------------------------------------------------------------------ */

export type AuthTokens = {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<{ userConfirmed: boolean }> {
  const username = normalizeEmail(email);
  const client = getClient();
  const res = await client.send(
    new SignUpCommand({
      ClientId: env('COGNITO_CLIENT_ID'),
      SecretHash: secretHash(username),
      Username: username,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: username },
        { Name: 'name', Value: name },
      ],
    }),
  );
  return { userConfirmed: res.UserConfirmed === true };
}

export async function confirmSignUp(
  email: string,
  code: string,
): Promise<void> {
  const username = normalizeEmail(email);
  const client = getClient();
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: env('COGNITO_CLIENT_ID'),
      SecretHash: secretHash(username),
      Username: username,
      ConfirmationCode: (code ?? '').trim(),
    }),
  );
}

export async function signIn(
  email: string,
  password: string,
): Promise<AuthTokens> {
  const username = normalizeEmail(email);
  const client = getClient();
  const res = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: env('COGNITO_CLIENT_ID'),
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
        SECRET_HASH: secretHash(username),
      },
    }),
  );

  const result = res.AuthenticationResult;
  if (!result?.IdToken) throw new AuthChallengeError(res.ChallengeName);

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn,
  };
}

export async function resendCode(email: string): Promise<void> {
  const username = normalizeEmail(email);
  const client = getClient();
  await client.send(
    new ResendConfirmationCodeCommand({
      ClientId: env('COGNITO_CLIENT_ID'),
      SecretHash: secretHash(username),
      Username: username,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Session cookies                                                     */
/* ------------------------------------------------------------------ */

export type SessionUser = {
  sub: string;
  email: string;
  name: string | null;
  /** Unix seconds. */
  exp: number;
};

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/**
 * Reads the payload segment of a JWT. Display only.
 *
 * PRODUCTION NOTE: this does **not** verify the signature. A real deployment
 * should verify the id token against the pool's JWKS
 * (https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json)
 * before trusting any claim. For a hackathon the token never leaves an
 * httpOnly cookie we set ourselves, so decoding for display is the right
 * tradeoff — but it is a tradeoff.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const json = Buffer.from(segments[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function userFromIdToken(idToken: string): SessionUser | null {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!exp || exp * 1000 <= Date.now()) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) return null;

  const email = typeof payload.email === 'string' ? payload.email : '';
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';

  return { sub, email, name: rawName || null, exp };
}

/** Stores the id + refresh tokens as httpOnly cookies. Returns the decoded
 *  user so callers don't have to decode a second time. */
export async function setSessionCookies(
  tokens: AuthTokens,
): Promise<SessionUser | null> {
  // Next.js 16: `cookies()` is async and must be awaited.
  const store = await cookies();
  const maxAge =
    tokens.expiresIn && tokens.expiresIn > 0
      ? tokens.expiresIn
      : ID_TOKEN_FALLBACK_MAX_AGE;

  store.set(ID_TOKEN_COOKIE, tokens.idToken, { ...cookieOptions(), maxAge });
  if (tokens.refreshToken) {
    store.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...cookieOptions(),
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
  }

  return userFromIdToken(tokens.idToken);
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  // An expired empty value with matching attributes is what actually evicts
  // the cookie; `delete()` alone can miss one written with a different path.
  for (const name of [ID_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
    store.set(name, '', { ...cookieOptions(), maxAge: 0 });
  }
}

/** Never throws. An absent, malformed, or expired cookie is simply `null`. */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(ID_TOKEN_COOKIE)?.value;
    if (!token) return null;
    return userFromIdToken(token);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Friendly error mapping                                              */
/* ------------------------------------------------------------------ */

export type AuthErrorInfo = {
  status: number;
  /** Machine-readable code for the client; never shown to a person. */
  code: string;
  /** Human copy, safe to render. Never a raw AWS exception string. */
  message: string;
  needsConfirmation?: boolean;
};

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  if (err && typeof err === 'object') {
    const maybe = err as { name?: unknown; __type?: unknown };
    if (typeof maybe.name === 'string') return maybe.name;
    if (typeof maybe.__type === 'string') return maybe.__type;
  }
  return 'UnknownError';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

/**
 * Turns an AWS exception into copy a person can act on. Raw exception
 * strings never reach the UI — several of them ("Unable to verify secret
 * hash for client…") actively mislead.
 */
export function friendlyAuthError(err: unknown): AuthErrorInfo {
  if (err instanceof AuthNotConfiguredError) {
    return {
      status: 503,
      code: 'not_configured',
      message: "Accounts aren't switched on yet.",
    };
  }
  if (err instanceof AuthChallengeError) {
    return {
      status: 400,
      code: 'challenge_unsupported',
      message: 'This account needs extra setup before it can sign in here.',
    };
  }

  const name = errorName(err);
  const raw = errorMessage(err);

  switch (name) {
    case 'UsernameExistsException':
      return {
        status: 409,
        code: 'email_taken',
        message: 'That email already has an account. Sign in instead.',
      };

    case 'InvalidPasswordException':
      return {
        status: 400,
        code: 'weak_password',
        message:
          'That password is missing something. It needs 8+ characters with an uppercase letter, a lowercase letter, a number, and a symbol.',
      };

    case 'InvalidParameterException':
      // The single most common setup mistake, and the message names the fix.
      if (raw.includes('USER_PASSWORD_AUTH')) {
        return {
          status: 503,
          code: 'flow_disabled',
          message:
            "Password sign-in isn't enabled on this app client yet. Turn on ALLOW_USER_PASSWORD_AUTH in Cognito.",
        };
      }
      return {
        status: 400,
        code: 'invalid_input',
        message: 'Check the details above and try again.',
      };

    case 'CodeMismatchException':
      return {
        status: 400,
        code: 'code_mismatch',
        message: "That code doesn't match. Check the email and retype it.",
      };

    case 'ExpiredCodeException':
      return {
        status: 400,
        code: 'code_expired',
        message: 'That code has expired. Send a new one and try again.',
      };

    case 'UserNotConfirmedException':
      return {
        status: 403,
        code: 'needs_confirmation',
        message: 'Confirm your email to finish setting up this account.',
        needsConfirmation: true,
      };

    case 'UserNotFoundException':
      // Note: this confirms whether an account exists. A production build
      // should return the same copy as a wrong password to avoid account
      // enumeration; the friendlier message wins for a demo.
      return {
        status: 404,
        code: 'no_account',
        message: "We couldn't find an account with that email.",
      };

    case 'NotAuthorizedException':
      if (raw.includes('secret hash')) {
        return {
          status: 503,
          code: 'bad_client_secret',
          message:
            "Sign-in isn't set up correctly yet. Check COGNITO_CLIENT_SECRET.",
        };
      }
      if (raw.includes('Current status is CONFIRMED')) {
        return {
          status: 409,
          code: 'already_confirmed',
          message: "This email is already confirmed. Go ahead and sign in.",
        };
      }
      if (raw.includes('disabled')) {
        return {
          status: 403,
          code: 'account_disabled',
          message: 'This account is disabled.',
        };
      }
      return {
        status: 401,
        code: 'bad_credentials',
        message: "That email and password don't match.",
      };

    case 'PasswordResetRequiredException':
      return {
        status: 403,
        code: 'reset_required',
        message: 'This account needs its password reset before signing in.',
      };

    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
    case 'LimitExceededException':
      return {
        status: 429,
        code: 'rate_limited',
        message: 'Too many tries. Wait a minute, then have another go.',
      };

    case 'CodeDeliveryFailureException':
      return {
        status: 502,
        code: 'delivery_failed',
        message: "We couldn't send a code to that address.",
      };

    case 'ResourceNotFoundException':
      return {
        status: 503,
        code: 'not_configured',
        message: "Accounts aren't switched on yet.",
      };

    case 'TimeoutError':
    case 'AbortError':
    case 'NetworkingError':
      return {
        status: 504,
        code: 'unreachable',
        message: "Couldn't reach the sign-in service. Try again in a moment.",
      };

    default:
      return {
        status: 500,
        code: 'unknown',
        message: 'Something went wrong on our end. Try again.',
      };
  }
}

/* ------------------------------------------------------------------ */
/* Route-handler plumbing                                              */
/*                                                                     */
/* Shared here so every `app/api/auth/*` handler returns the same       */
/* JSON shape and none of them can throw.                              */
/* ------------------------------------------------------------------ */

/** 503 that the client is expected to read as "auth is simply off". */
export function notConfiguredResponse(): Response {
  return Response.json(
    {
      ok: false,
      reason: 'not_configured',
      error: "Accounts aren't switched on yet.",
    },
    { status: 503 },
  );
}

export function authErrorResponse(err: unknown): Response {
  const info = friendlyAuthError(err);
  return Response.json(
    {
      ok: false,
      reason: info.code,
      error: info.message,
      ...(info.needsConfirmation ? { needsConfirmation: true } : {}),
    },
    { status: info.status },
  );
}

export function badRequest(message: string, reason = 'invalid_input'): Response {
  return Response.json({ ok: false, reason, error: message }, { status: 400 });
}

/** Never throws on a malformed or absent body. */
export async function readJsonBody(
  req: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
