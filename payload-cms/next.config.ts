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
            key: 'X-Frame-Options',
            value: 'DENY', // Use 'SAMEORIGIN' if you need your own iframes
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
