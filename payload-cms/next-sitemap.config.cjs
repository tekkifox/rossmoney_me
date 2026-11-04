/**
 * Public origin for `robots.txt` and its sitemap reference.
 *
 * Mirrors `src/utilities/siteURL.ts` (this file is CommonJS and runs from
 * `next-sitemap` after the build). `VERCEL_PROJECT_PRODUCTION_URL` is a bare
 * hostname, which produced scheme-less `Sitemap:` lines, so it is not used;
 * prefer the explicit public origin and normalise a bare host to HTTPS.
 */
const configuredSiteUrl =
  process.env.SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  'https://www.rossmoney.me'

const SITE_URL = /^https?:\/\//i.test(configuredSiteUrl)
  ? configuredSiteUrl.replace(/\/+$/, '')
  : `https://${configuredSiteUrl.replace(/\/+$/, '')}`

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: SITE_URL,
  generateRobotsTxt: true,
  exclude: ['/pages-sitemap.xml', '/*', '/posts/*'],
  robotsTxtOptions: {
    // Default policy for all crawlers: block admin and API endpoints, allow public media
    policies: [
      {
        userAgent: '*',
        disallow: ['/admin/*', '/api/*', '/payload/*'],
        allow: ['/media/*', '/'],
      },
    ],
    additionalSitemaps: [`${SITE_URL}/pages-sitemap.xml`],
  },
}
