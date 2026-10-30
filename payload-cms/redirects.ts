import type { NextConfig } from 'next'

/**
 * Pages retired from the site: their documents stay in the CMS (the assembled
 * site payload still uses their data) but they are no longer published or
 * rendered. Old URLs — bookmarks, search results, links from elsewhere — land
 * on the matching homepage section instead of a 404.
 *
 * `/experience-page` stays as a legacy alias for `/experience`.
 */
const retiredPageRedirects = [
  { source: '/work', destination: '/#work' },
  { source: '/commits', destination: '/#commits' },
  { source: '/experience', destination: '/#experience' },
  { source: '/experience-page', destination: '/#experience' },
  { source: '/architecture', destination: '/#architecture' },
].map((redirect) => ({ ...redirect, permanent: true }))

export const redirects: NextConfig['redirects'] = async () => {
  const internetExplorerRedirect = {
    destination: '/ie-incompatible.html',
    has: [
      {
        type: 'header' as const,
        key: 'user-agent',
        value: '(.*Trident.*)', // all ie browsers
      },
    ],
    permanent: false,
    source: '/:path((?!ie-incompatible.html$).*)', // all pages except the incompatibility page
  }

  return [...retiredPageRedirects, internetExplorerRedirect]
}
