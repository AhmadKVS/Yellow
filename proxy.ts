import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ID_TOKEN_COOKIE = 'yellow_id_token';

/** Reachable signed-out. Everything else requires a session. */
const PUBLIC_PATHS = ['/login', '/signup'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Auth endpoints must stay open or there is no way to obtain a session.
  if (pathname.startsWith('/api/auth/')) return true;
  return false;
}

/**
 * Presence + expiry check only — the signature is not verified here.
 * The cookie is httpOnly so page scripts cannot mint one, and every route
 * handler that touches user data re-derives identity server-side. A
 * production build should additionally verify against the pool's JWKS.
 */
function hasValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof claims.exp !== 'number') return false;
    return claims.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const enforced = process.env.NEXT_PUBLIC_AUTH_REQUIRED === 'true';
  const cognitoReady = Boolean(
    process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID,
  );

  // Locking the app while Cognito is unconfigured would make it permanently
  // unreachable — nobody could sign in to get past the wall.
  if (!enforced || !cognitoReady) return NextResponse.next();

  const authed = hasValidSession(request.cookies.get(ID_TOKEN_COOKIE)?.value);

  if (isPublic(pathname)) {
    if (authed && (pathname === '/login' || pathname === '/signup')) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  // Unauthenticated API calls get JSON, not an HTML redirect a fetch can't read.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, error: 'unauthenticated' },
      { status: 401 },
    );
  }

  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except Next internals, the favicon, and static asset files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
  ],
};
