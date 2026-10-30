import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating dev badge sits over the sidebar's sign-out button.
  devIndicators: false,
  // The browser only ever talks to this origin; /api is proxied to the portal API server.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
