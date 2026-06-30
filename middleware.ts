import { NextRequest, NextResponse } from 'next/server';
import { verifyJanSession, JAN_SESSION_COOKIE } from '@/lib/jan-sso';

/**
 * Auth gate for page routes. An unauthenticated request to any page is redirected to
 * /login (carrying returnUrl). The matcher excludes /api, /login and static assets, so
 * API routes (used by integrations/cron) and the login flow itself are not gated here.
 */
export async function middleware(request: NextRequest) {
  // Fail-open if no signing secret is configured: auth stays OFF until the secret is set,
  // so deploying can never lock everyone out. Setting the secret = enabling auth.
  const authConfigured = !!(
    process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET
  );
  if (!authConfigured) return NextResponse.next();

  const token = request.cookies.get(JAN_SESSION_COOKIE)?.value;
  const session = await verifyJanSession(token);
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?returnUrl=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Gate everything except: api routes, the login page, Next internals and static files.
    '/((?!api|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
