import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)
import { redirects } from './redirects'

const NEXT_PUBLIC_SERVER_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.__NEXT_PRIVATE_ORIGIN || 'http://localhost:3000'

const nextConfig: NextConfig = {
  // Temporarily required on Windows until Next.js fixes Turbopack Sass resolution.
  // See: https://github.com/vercel/next.js/issues/86431
    async headers() {
    return [
      {
        // Apply these headers to all routes in your application
        source: '/:path*',
        headers: [
          {
            // Mirrors the public CSP (`frame-ancestors 'self'`). Payload's Live
            // Preview frames the public page from the admin, which is the same
            // origin. The admin path below tightens this back to DENY.
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          // Content-Security-Policy is emitted per request by `src/proxy.ts`,
          // which also puts the nonce on the forwarded request so Next.js can
          // nonce its own scripts. Do not add a second CSP here: multiple
          // policies intersect, and a static one would block every nonced
          // script.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          {
            // Aligned with Vercel production. `preload` is only meaningful with
            // `includeSubDomains`, which the openresty surface was missing; the
            // apex, www and the preview host all serve HTTPS. Submitting the
            // domain to the preload list is still a separate decision.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // The global rule above relaxes `X-Frame-Options` to SAMEORIGIN so the
        // public page can be framed by Payload's Live Preview. The admin itself
        // is never a frame target; keep the stronger DENY there. This mirrors
        // the admin CSP's `frame-ancestors 'none'`.
        source: '/admin/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
      {
        // Payload's REST/GraphQL responses are cookie-capable. `public` shared
        // cache directives are the wrong default; the named exception is the
        // OG image renderer below, which is deliberately cacheable so social
        // crawlers do not burn CPU on every view.
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-store',
          },
        ],
      },
      {
        // Public, deterministic image generated from the request query. A long
        // CDN/browser lifetime is the cheapest guard for /api/og; the proxy
        // rate limit only has to cover cache misses.
        source: '/api/og',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
  sassOptions: {
    loadPaths: ['./node_modules/@payloadcms/ui/dist/scss/'],
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
    qualities: [100],
    remotePatterns: [
      ...[NEXT_PUBLIC_SERVER_URL /* 'https://example.com' */].map((item) => {
        const url = new URL(item)

        return {
          hostname: url.hostname,
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
        }
      }),
      // Vercel Blob media URLs are absolute and served from the project's store.
      {
        hostname: '*.public.blob.vercel-storage.com',
        protocol: 'https',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  reactStrictMode: true,
  // `withPayload` adds `X-Powered-By: Next.js, Payload` unless this is `false`.
  // The explicit false also stops Next.js emitting its own header.
  poweredByHeader: false,
  // Vercel runs x64 glibc Node functions, but the traced dependency tree still
  // carries sharp's musl native binaries (installed for the Alpine Docker
  // image). Excluding only the musl packages on Vercel keeps the Docker build
  // untouched while removing ~18 MB of unused native code per function.
  outputFileTracingExcludes: process.env.VERCEL
    ? {
        '/*': [
          'node_modules/.pnpm/@img+sharp-libvips-linuxmusl-*/**',
          'node_modules/.pnpm/@img+sharp-linuxmusl-*/**',
          // Also drop the pnpm symlinks so the packager cannot follow them.
          '**/@img/sharp-libvips-linuxmusl-*',
          '**/@img/sharp-linuxmusl-*',
        ],
      }
    : undefined,
  // Vercel builds with its own adapter and does not need a standalone server.
  // Next.js 16.3 leaves out `.next/next-server.js.nft.json` when an adapter and
  // `output: 'standalone'` are combined (vercel/next.js#96646), which fails the
  // deploy in onBuildComplete. Keep standalone for the Docker/Portainer images.
  output: process.env.VERCEL ? undefined : 'standalone',
  redirects,
  turbopack: {
    root: path.resolve(dirname),
    // Mammoth's browser zip reader imports `jszip`, and Turbopack otherwise
    // resolves jszip's Node entry point. That pulls in `readable-stream` and
    // Next's `util` polyfill, which feature-detects generators with
    // `Function(...)` at module load and trips a nonce-only CSP. JSZip only
    // needs a stream implementation for `generateNodeStream`, which the CV
    // viewer never calls, so a browser shim is sufficient.
    resolveAlias: {
      'readable-stream': './src/shims/readable-stream.ts',
    },
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
