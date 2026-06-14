import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/google-oauth';
import {
  createJanSession,
  getJanSessionCookieOptions,
  JAN_SESSION_COOKIE,
} from '@/lib/jan-sso';
import { verifyChatToken, CHAT_AUTH_COOKIE } from '@/lib/chat-session-bridge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const returnUrl = searchParams.get('returnUrl') || undefined;

    // Bridge: if user already has valid chat auth_token, skip Google OAuth
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
        const target = returnUrl || (isProduction ? 'https://dashboard.jan.parts/' : '/');
        const response = NextResponse.redirect(target);
        response.cookies.set({
          name: JAN_SESSION_COOKIE,
          value: token,
          ...getJanSessionCookieOptions(isProduction),
        });
        return response;
      }
    }

    const authUrl = getGoogleAuthUrl(returnUrl);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate Google auth URL: ' + msg },
      { status: 500 },
    );
  }
}
