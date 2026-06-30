import { NextRequest, NextResponse } from 'next/server';

// Clear ALL .jan.parts session cookies so one logout signs the user out
// of every app in the ecosystem (dashboard, ebay, chat, partly).
const COOKIES_TO_CLEAR = [
  'jan_session',      // dashboard/ebay/partly SSO
  'session',          // chat primary session
  'auth_token',       // chat JWT backup
  'authenticated',    // chat client-side flag
  'partly_session',   // partly's own cookie
];

function clear(request: NextRequest) {
  // Host-aware: clear both the LAN cookie (http://<ip>:3002, no domain) and the shared
  // https://*.jan.parts SSO cookie. Lands the user on the /login page.
  const host = (request.headers.get('host') || 'dashboard.jan.parts').toLowerCase();
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const isHttps = proto === 'https';
  const onJanDomain = host.endsWith('.jan.parts');
  const response = NextResponse.redirect(`${isHttps ? 'https' : 'http'}://${host}/login`);

  const baseOpts = { path: '/', maxAge: 0, secure: isHttps, sameSite: 'lax' as const };

  for (const name of COOKIES_TO_CLEAR) {
    response.cookies.set({ name, value: '', httpOnly: true, ...baseOpts });
    if (onJanDomain) response.cookies.set({ name, value: '', httpOnly: true, ...baseOpts, domain: '.jan.parts' });
  }
  // `authenticated` is non-httpOnly — clear it that way too
  response.cookies.set({ name: 'authenticated', value: '', httpOnly: false, ...baseOpts });
  if (onJanDomain) response.cookies.set({ name: 'authenticated', value: '', httpOnly: false, ...baseOpts, domain: '.jan.parts' });

  return response;
}

export async function GET(request: NextRequest) {
  return clear(request);
}

export async function POST(request: NextRequest) {
  return clear(request);
}
