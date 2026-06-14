import { OAuth2Client } from 'google-auth-library';
import { ALLOWED_DOMAIN } from './jan-sso';

let client: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (client) return client;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    (process.env.NODE_ENV === 'production'
      ? 'https://dashboard.jan.parts/api/auth/callback'
      : 'http://localhost:3000/api/auth/callback');

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  client = new OAuth2Client(clientId, clientSecret, redirectUri);
  return client;
}

export function getGoogleAuthUrl(returnUrl?: string): string {
  const oauth = getOAuthClient();
  const state = returnUrl
    ? Buffer.from(JSON.stringify({ returnUrl })).toString('base64')
    : undefined;
  return oauth.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
    hd: ALLOWED_DOMAIN,
    ...(state && { state }),
  });
}

export interface GoogleAuthResult {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd?: string;
}

export async function exchangeCodeForUser(
  code: string,
): Promise<GoogleAuthResult> {
  const oauth = getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) {
    throw new Error('No ID token received from Google');
  }
  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('Invalid Google ID token payload');

  if (payload.hd !== ALLOWED_DOMAIN) {
    throw new Error(`Only @${ALLOWED_DOMAIN} accounts are allowed`);
  }

  return {
    sub: payload.sub!,
    email: payload.email!,
    name: payload.name || payload.email!,
    picture: payload.picture || '',
    hd: payload.hd,
  };
}

export function parseOAuthState(state: string | null): { returnUrl?: string } {
  if (!state) return {};
  try {
    return JSON.parse(Buffer.from(state, 'base64').toString());
  } catch {
    return {};
  }
}
