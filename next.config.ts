import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {source: '/:path*', headers: [
        {key: 'X-Content-Type-Options', value: 'nosniff'},
        {key: 'X-Frame-Options', value: 'DENY'},
        {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
      ]},
      {source: '/crm/:path*', headers: [{key: 'X-Robots-Tag', value: 'noindex, nofollow'}]},
      {source: '/api/:path*', headers: [{key: 'Cache-Control', value: 'no-store'}]},
    ];
  },
};

export default nextConfig;
