import { NextRequest, NextResponse } from 'next/server';
import {
  verifyJanSession,
  JAN_SESSION_COOKIE,
  createJanSession,
  getJanSessionCookieOptions,
} from '@/lib/jan-sso';
import { verifyChatToken, CHAT_AUTH_COOKIE } from '@/lib/chat-session-bridge';

/**
 * Auth middleware (additive SSO).
 *
 * Precedence:
 *   1. Google SSO cookie (`jan_session`) — set by dashboard.jan.parts after OAuth.
 *      Works across all *.jan.parts apps. Used by browser users.
 *   2. API key (`DASHBOARD_API_KEY`) — used by service-to-service calls.
 *
 * If neither works on an /api/* request → 401.
 * If neither works on a page request → redirect to SSO login.
 *
 * If DASHBOARD_API_KEY is NOT set AND no SSO cookie, allow through (dev mode).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for health check, cron, and auth endpoints
  if (
    pathname === '/api/health' ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/auth/')
  ) {
    return NextResponse.next();
  }

  // 1. Try Google SSO cookie first
  const ssoCookie = request.cookies.get(JAN_SESSION_COOKIE)?.value;
  if (ssoCookie) {
    const claims = await verifyJanSession(ssoCookie);
    if (claims) {
      return NextResponse.next();
    }
  }

  // 1b. Bridge from chat.jan.parts — if user has valid chat auth_token,
  // auto-mint jan_session (zero chat deploys needed)
  const chatCookie = request.cookies.get(CHAT_AUTH_COOKIE)?.value;
  if (chatCookie) {
    const chatUser = await verifyChatToken(chatCookie);
    if (chatUser) {
      const token = await createJanSession({
        sub: chatUser.id,
        email: chatUser.email,
        name: chatUser.name,
        picture: chatUser.picture,
        hd: 'jan.co.il',
      });
      const isProduction = process.env.NODE_ENV === 'production';
      const response = NextResponse.next();
      response.cookies.set({
        name: JAN_SESSION_COOKIE,
        value: token,
        ...getJanSessionCookieOptions(isProduction),
      });
      return response;
    }
  }

  // 2. Fall back to API key (service-to-service)
  const apiKey = process.env.DASHBOARD_API_KEY;
  if (apiKey) {
    const authHeader = request.headers.get('authorization');
    const xApiKey = request.headers.get('x-api-key');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xApiKey;
    if (token === apiKey) {
      return NextResponse.next();
    }
  }

  // SSO is enabled once JAN_AUTH_JWT_SECRET is configured
  const ssoEnabled = !!(
    process.env.JAN_AUTH_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.AUTH_SECRET
  );

  // If neither SSO nor API key is configured → dev mode passthrough
  if (!ssoEnabled && !apiKey) {
    return NextResponse.next();
  }

  // All auth failed — reject
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        error:
          'Unauthorized. Provide a valid jan_session cookie (login at /api/auth/login) or API key via Authorization: Bearer <key> or x-api-key header.',
      },
      { status: 401 },
    );
  }

  // Page request → redirect to SSO login (local — dashboard IS the auth service)
  const host = request.headers.get('host') || 'dashboard.jan.parts';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const returnUrl = `${protocol}://${host}${pathname}${request.nextUrl.search}`;
  const loginUrl = new URL('/api/auth/login', request.url);
  loginUrl.searchParams.set('returnUrl', returnUrl);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
