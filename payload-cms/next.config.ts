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
        // Apply these headers to all routes except the Ackee ingestion proxy.
        // `/a/*` is a rewrite to the Ackee container, not a document this app
        // renders: giving its JS/API responses the site's document security
        // headers (and the proxy's CSP) would be misleading, and the `/api/*`
        // cache rule below must not turn collection POSTs into no-store
        // admin-style responses. The negative lookahead keeps the rewrite
        // namespace out of the blanket rule.
        source: '/:path((?!a(?:/|$)).*)',
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
        // cache directives are the wrong default; the named exceptions below
        // are deliberately cacheable.
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-store',
          },
        ],
      },
      {
        // Uploaded media is public, immutable in practice and served from the
        // same route as the CV. Uploads are not content-hashed, so a browser
        // gets a week and a shared cache may revalidate in the background; a
        // replaced file becomes visible within that window.
        source: '/api/media/file/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=86400',
          },
        ],
      },
      {
        // Next.js already serves content-hashed build output with a year and
        // `immutable`. State it here as well so the contract survives whichever
        // front end (openresty, Vercel, a CDN) terminates the request.
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Architecture snapshots are public, redacted and identical for every
        // visitor. Let a shared cache absorb the 45-second client poll; the
        // route's own in-process cache still answers the next miss.
        source: '/api/architecture',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=30, stale-while-revalidate=120',
          },
        ],
      },
      {
        // Public, deterministic image generated from the request query. The
        // query is part of the cache key, so a page edit produces a new URL and
        // the old card can stay immutable for a year. Keep this value in step
        // with `OG_IMAGE_CACHE_CONTROL` in `src/utilities/ogImage.ts`.
        source: '/api/og',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, immutable',
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
      {
        // The Map page's diagram is a static file in `public/`, not CMS media.
        // Allow exactly that path, with no query string, so the default
        // allowlist stays as narrow as the page requires.
        pathname: '/infrastructure-map.png',
        search: '',
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
  // CV conversion runs in the Node runtime at upload time. pdfjs-dist ships a
  // worker and optional canvas bindings that should stay outside the server
  // bundle; text extraction only needs the plain Node entry point.
  serverExternalPackages: ['pdfjs-dist'],
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
  // pdfjs loads its worker with a dynamic `import()`, so the tracer cannot see
  // it from the server bundle. CV conversion runs from the media upload hooks
  // (REST/admin/GraphQL), so include the worker and its siblings on every
  // server trace; the whole legacy build is only a few files.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pdfjs-dist/legacy/build/*.mjs'],
  },
  // Vercel builds with its own adapter and does not need a standalone server.
  // Next.js 16.3 leaves out `.next/next-server.js.nft.json` when an adapter and
  // `output: 'standalone'` are combined (vercel/next.js#96646), which fails the
  // deploy in onBuildComplete. Keep standalone for the Docker/Portainer images.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Ackee's tracker and collection API are served first-party under `/a` so the
  // public CSP needs no new host source: `connect-src 'self'` covers the API
  // and the tracker is a same-origin script the public script allowlist admits.
  // `beforeFiles` makes the namespace win before the `[slug]` page route, while
  // `/a` is not an existing route, so nothing public is shadowed. The
  // destination is the Docker service name on the CMS's compose network.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/a/:path*',
          destination: 'http://ackee:3000/:path*',
        },
      ],
      afterFiles: [
        {
          // The homepage document stores the slug `home`. Serving it through
          // the dynamic `[slug]` route (instead of a literal `app/page.tsx`) is
          // what lets it be generated on demand from the live database rather
          // than frozen during the build, which uses Payload's no-op database
          // adapter.
          source: '/',
          destination: '/home',
        },
      ],
    }
  },
  redirects,
  turbopack: {
    // Turbopack must see the workspace root: pnpm links this package's
    // dependencies to `../node_modules/.pnpm`, and Turbopack refuses to resolve
    // files outside its root.
    root: path.resolve(dirname, '..'),
    // Mammoth's zip reader imports `jszip`, and Turbopack otherwise resolves
    // jszip's Node entry point. That pulls in `readable-stream` and Next's
    // `util` polyfill, which feature-detects generators with `Function(...)`
    // at module load and trips a nonce-only CSP. JSZip only needs a stream
    // implementation for `generateNodeStream`, which the CV converter never
    // calls (it only reads the archive), so a small shim is sufficient.
    resolveAlias: {
      'readable-stream': './src/shims/readable-stream.ts',
    },
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
