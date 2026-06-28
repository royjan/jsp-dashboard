import { NextResponse } from 'next/server';

/**
 * Auth disabled — dashboard is open access.
 * Middleware is a passthrough; no login redirect or 401 is enforced.
 */
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
