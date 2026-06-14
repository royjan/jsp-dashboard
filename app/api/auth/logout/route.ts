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
  const isProduction = process.env.NODE_ENV === 'production';
  const host = request.headers.get('host') || 'dashboard.jan.parts';
  const baseUrl = isProduction ? 'https://dashboard.jan.parts' : `http://${host}`;
  const response = NextResponse.redirect(`${baseUrl}/api/auth/login`);

  const baseOpts = {
    path: '/',
    maxAge: 0,
    secure: isProduction,
    sameSite: 'lax' as const,
    ...(isProduction ? { domain: '.jan.parts' } : {}),
  };

  for (const name of COOKIES_TO_CLEAR) {
    // Set httpOnly cookies
    response.cookies.set({ name, value: '', httpOnly: true, ...baseOpts });
    // Also clear without httpOnly flag (for `authenticated` which is client-readable)
  }
  // `authenticated` is non-httpOnly — clear it that way too
  response.cookies.set({
    name: 'authenticated',
    value: '',
    httpOnly: false,
    ...baseOpts,
  });

  return response;
}

export async function GET(request: NextRequest) {
  return clear(request);
}

export async function POST(request: NextRequest) {
  return clear(request);
}
