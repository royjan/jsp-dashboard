import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForUser, parseOAuthState } from '@/lib/google-oauth';
import {
  createJanSession,
  getJanSessionCookieOptions,
  JAN_SESSION_COOKIE,
} from '@/lib/jan-sso';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  const host = request.headers.get('host') || 'dashboard.jan.parts';
  const isProduction = process.env.NODE_ENV === 'production';
  const baseUrl = isProduction ? 'https://dashboard.jan.parts' : `http://${host}`;

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/?auth_error=${encodeURIComponent(error)}`,
    );
  }
  if (!code) {
    return NextResponse.redirect(`${baseUrl}/?auth_error=missing_code`);
  }

  try {
    const user = await exchangeCodeForUser(code);
    const { returnUrl } = parseOAuthState(state);
    const token = await createJanSession(user);

    // Redirect to returnUrl if provided, otherwise home
    let redirectTarget = `${baseUrl}/`;
    if (returnUrl) {
      // Only allow redirects to *.jan.parts or the current host
      try {
        const target = new URL(returnUrl);
        if (
          target.hostname.endsWith('.jan.parts') ||
          target.hostname === 'jan.parts' ||
          target.hostname === host
        ) {
          redirectTarget = returnUrl;
        }
      } catch {
        // Invalid URL — fall back to home
      }
    }

    const response = NextResponse.redirect(redirectTarget);
    const cookieOpts = getJanSessionCookieOptions(isProduction);
    response.cookies.set({
      name: JAN_SESSION_COOKIE,
      value: token,
      ...cookieOpts,
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.redirect(
      `${baseUrl}/?auth_error=${encodeURIComponent(msg)}`,
    );
  }
}
