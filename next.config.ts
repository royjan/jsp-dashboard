import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // NOTE: 'Content-Security-Policy: upgrade-insecure-requests' removed —
          // it forces all sub-resources to HTTPS, which breaks plain-HTTP access
          // (the internal/LAN box). HTTPS is enforced at the edge in prod anyway.
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ]
  },
}

export default nextConfig
