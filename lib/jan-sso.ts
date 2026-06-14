// Google SSO for *.jan.parts apps. Dashboard is the auth service.
// Issues + verifies `jan_session` JWT cookie on .jan.parts domain.
import { SignJWT, jwtVerify } from 'jose';

export const JAN_SESSION_COOKIE = 'jan_session';
export const ALLOWED_DOMAIN = 'jan.co.il';
export const SSO_LOGIN_URL = 'https://dashboard.jan.parts/api/auth/login';
export const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

export interface JanSessionClaims {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd?: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

function getJanJwtSecret(): Uint8Array | null {
  const secret =
    process.env.JAN_AUTH_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function verifyJanSession(
  token: string | undefined,
): Promise<JanSessionClaims | null> {
  if (!token) return null;
  const key = getJanJwtSecret();
  if (!key) return null; // SSO not configured — fall through to existing auth
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: 'jan-auth',
      audience: 'jan-apps',
    });
    const claims = payload as unknown as JanSessionClaims;
    if (claims.hd !== ALLOWED_DOMAIN) return null;
    return claims;
  } catch {
    return null;
  }
}

export function buildSsoLoginUrl(returnUrl: string): string {
  return `${SSO_LOGIN_URL}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

export interface JanUserInput {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd?: string;
}

export async function createJanSession(user: JanUserInput): Promise<string> {
  const key = getJanJwtSecret();
  if (!key) throw new Error('JAN_AUTH_JWT_SECRET not configured');
  return new SignJWT({
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
    hd: user.hd,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('jan-auth')
    .setAudience('jan-apps')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_DURATION)
    .sign(key);
}

export function getJanSessionCookieOptions(isProduction: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  maxAge: number;
  path: string;
  domain?: string;
} {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
    ...(isProduction ? { domain: '.jan.parts' } : {}),
  };
}
