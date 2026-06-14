// Auto-upgrade bridge: if user has a valid chat.jan.parts `auth_token` cookie,
// mint a `jan_session` cookie for cross-app SSO. Zero chat deploys required.
//
// Chat's auth_token is a jsonwebtoken JWT:
//   alg: HS256, issuer: 'jsp-chat-js', audience: 'jsp-chat-users'
//   secret: JWT_SECRET (shared via AWS Secrets Manager `config`)
//   payload: { user: { id, email, name, picture, verified_email }, iat, exp }
import { jwtVerify } from 'jose';

export const CHAT_AUTH_COOKIE = 'auth_token';

export interface ChatTokenPayload {
  user: {
    id: string;
    email: string;
    name: string;
    picture: string;
    verified_email: boolean;
  };
  iat: number;
  exp: number;
}

function getChatJwtSecret(): Uint8Array | null {
  // Chat signs with JWT_SECRET. Dashboard reads same secret from env
  // (injected via App Runner RuntimeEnvironmentSecrets from `config` secret).
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Verify chat's auth_token cookie and return user info if valid.
 * Returns null if no cookie, invalid, expired, or wrong domain.
 */
export async function verifyChatToken(
  token: string | undefined,
): Promise<ChatTokenPayload['user'] | null> {
  if (!token) return null;
  const key = getChatJwtSecret();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: 'jsp-chat-js',
      audience: 'jsp-chat-users',
    });
    const p = payload as unknown as ChatTokenPayload;
    // Only accept @jan.co.il accounts
    if (!p.user?.email?.endsWith('@jan.co.il')) return null;
    return p.user;
  } catch {
    return null;
  }
}
