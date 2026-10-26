import { normaliseOrigin } from './adminOrigin'

/**
 * The Content-Security-Policy for every document this app serves.
 *
 * The policy starts from `default-src 'none'` and re-adds only what the app
 * actually requests. Each source is justified in `docs/security/csp.md`; do not
 * add one without recording why, because the next person will otherwise be
 * unable to tell whether it is still needed.
 *
 * A per-request nonce is used for scripts. Next.js reads the nonce from the
 * `Content-Security-Policy` *request* header (see `getScriptNonceFromHeader` in
 * `next/dist/server/app-render`), so `proxy.ts` sets it on both the forwarded
 * request and the response. The admin panel is a Next.js app too, so its
 * framework scripts receive the same nonce. Payload's inline `style` attributes
 * cannot be nonced, which is why `style-src` keeps `'unsafe-inline'`.
 */

/** Vercel Blob public store host used by the storage adapter on Vercel. */
export const VERCEL_BLOB_ORIGIN = 'https://*.public.blob.vercel-storage.com'

/**
 * Payload's admin renders the signed-in user's Gravatar. Only the admin policy
 * allows it; public pages never request an avatar.
 */
const GRAVATAR_ORIGINS = ['https://www.gravatar.com', 'https://secure.gravatar.com']

/**
 * Payload's JSON/code fields use `@monaco-editor/react`, whose loader fetches
 * Monaco (script, stylesheet, codicon font, workers) from jsDelivr by default.
 * This is an admin-only, pre-existing third-party dependency; the public site
 * never contacts it. Self-hosting Monaco would let this source be removed.
 */
const MONACO_CDN_ORIGIN = 'https://cdn.jsdelivr.net'

/**
 * Google reCAPTCHA v3, loaded by the public contact form on submit. The script
 * is inserted by the nonced bundle (so `strict-dynamic` permits it), but the
 * challenge iframe and the token request are separate directives. These are the
 * only Google origins the public site is allowed to contact.
 */
const RECAPTCHA_ORIGINS = ['https://www.google.com', 'https://www.gstatic.com']

/**
 * External ArchView hosts the browser is allowed to call.
 *
 * The gameservers page stores `archviewUrl` in the CMS and
 * `ArchitectureClient` fetches `<archviewUrl>/api/architecture` from the
 * browser. The public instance is `archview.vortexservers.co.uk`; additional
 * origins can be supplied through `ARCHVIEW_URL`/`ARCHVIEW_HOST` without a code
 * change. Keeping this an explicit list (rather than `https:`) means a
 * compromised page cannot exfiltrate through an arbitrary HTTPS origin.
 */
const KNOWN_ARCHVIEW_ORIGINS = ['https://archview.vortexservers.co.uk']

/**
 * Vercel Toolbar sources. Vercel injects the toolbar (and its feedback iframe)
 * into preview deployments for signed-in Vercel users. The list is taken from
 * Vercel's documented CSP requirements; it is only added when the request runs
 * on a preview deployment, never on the production site.
 *
 * @see https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy
 */
const VERCEL_TOOLBAR_ORIGIN = 'https://vercel.live'
const VERCEL_TOOLBAR_CONNECT_ORIGINS = [
  'https://vercel.live',
  'wss://ws-us3.pusher.com',
]
const VERCEL_TOOLBAR_IMAGE_ORIGINS = ['https://vercel.live', 'https://vercel.com']
const VERCEL_TOOLBAR_FONT_ORIGINS = [
  'https://vercel.live',
  'https://assets.vercel.com',
]

/**
 * A nonce with 122 bits of entropy. Hex is accepted by Next.js' nonce parser
 * (`^'nonce-[A-Za-z0-9+/_-]+={0,2}'$`) and avoids any base64 padding questions.
 */
export const createNonce = (): string => globalThis.crypto.randomUUID().replace(/-/g, '')

/** Origins from the environment that the browser may call for ArchView data. */
export const archviewOrigins = (
  env: Record<string, string | undefined> = process.env,
): string[] => {
  const values = [env.ARCHVIEW_URL, env.ARCHVIEW_HOST]
  const origins = values
    .map((value) => {
      if (!value) {
        return null
      }
      const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return normaliseOrigin(withScheme)
    })
    // The browser only ever calls the public HTTPS instance. An internal
    // `http://archview:8080` value is for the server-side proxy, not the CSP.
    .filter((value): value is string => Boolean(value?.startsWith('https://')))

  return [...new Set([...KNOWN_ARCHVIEW_ORIGINS, ...origins])]
}

export type ContentSecurityPolicyOptions = {
  nonce: string
  /** Adds `upgrade-insecure-requests`; only meaningful on HTTPS responses. */
  isHttps?: boolean
  /** Extra `connect-src` origins, e.g. an ArchView instance. */
  connectOrigins?: string[]
  /** Adds sources only the Payload admin needs (the user's Gravatar). */
  isAdmin?: boolean
  /**
   * Adds the Vercel Toolbar's documented sources. Only enable this on Vercel
   * preview deployments, where the toolbar is injected.
   */
  vercelToolbar?: boolean
}

/**
 * Build the header value. Kept free of request and Next.js state so the policy
 * can be unit-tested with plain environment overrides.
 */
export function buildContentSecurityPolicy({
  nonce,
  isHttps = false,
  connectOrigins = [],
  isAdmin = false,
  // Vercel injects its Toolbar into preview deployments for signed-in Vercel
  // users. Detected here (rather than in `proxy.ts`) because the builder owns
  // the policy and proxy is shared with another change.
  vercelToolbar = process.env.VERCEL_ENV === 'preview',
}: ContentSecurityPolicyOptions): string {
  const connectSources = [
    "'self'",
    VERCEL_BLOB_ORIGIN,
    ...archviewOrigins(),
    ...connectOrigins,
  ]
    .map((source) => (source.startsWith("'") ? source : normaliseOrigin(source)))
    .filter((source): source is string => Boolean(source))

  const adminSources = isAdmin ? ` ${MONACO_CDN_ORIGIN}` : ''
  const adminImages = isAdmin
    ? ` ${GRAVATAR_ORIGINS.join(' ')} ${MONACO_CDN_ORIGIN}`
    : ''
  // The contact form appears on public pages only; the admin never loads
  // reCAPTCHA. Host sources in script-src are the CSP2 fallback; CSP3 browsers
  // rely on `strict-dynamic` and the nonce.
  const publicScriptSources = isAdmin ? '' : ` ${RECAPTCHA_ORIGINS.join(' ')}`
  const publicConnectSources = isAdmin ? '' : ` ${RECAPTCHA_ORIGINS.join(' ')}`
  const publicImageSources = isAdmin ? '' : ' https://www.gstatic.com'

  const toolbarScript = vercelToolbar ? ` ${VERCEL_TOOLBAR_ORIGIN}` : ''
  // The toolbar's feedback script injects inline <style> elements, so a public
  // preview policy has to allow inline stylesheet text. The admin policy
  // already carries `'unsafe-inline'`.
  const toolbarStyle = vercelToolbar
    ? ` ${VERCEL_TOOLBAR_ORIGIN}${isAdmin ? '' : " 'unsafe-inline'"}`
    : ''
  const toolbarConnect = vercelToolbar
    ? ` ${VERCEL_TOOLBAR_CONNECT_ORIGINS.join(' ')}`
    : ''
  const toolbarImages = vercelToolbar
    ? ` ${VERCEL_TOOLBAR_IMAGE_ORIGINS.join(' ')}`
    : ''
  const toolbarFonts = vercelToolbar
    ? ` ${VERCEL_TOOLBAR_FONT_ORIGINS.join(' ')}`
    : ''
  const toolbarFrame = vercelToolbar ? ` ${VERCEL_TOOLBAR_ORIGIN}` : ''

  const directives = [
    "default-src 'none'",
    // `strict-dynamic` lets the nonced Next.js bootstrap load its chunks and
    // lets the analytics packages insert their same-origin script tags. `'self'`
    // remains for browsers that do not implement strict-dynamic, and the
    // jsDelivr host is the CSP2 fallback for Payload's Monaco loader.
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'${publicScriptSources}${adminSources}${toolbarScript}`,
    // Public pages use inline `style` *attributes* (React `style` props) but no
    // inline `<style>` elements, so they can allow attributes without allowing
    // inline stylesheet text. Payload's admin also injects `<style>` elements,
    // so the admin keeps `'unsafe-inline'` there. Monaco's stylesheet is the
    // only external stylesheet the admin loads.
    isAdmin
      ? `style-src 'self' 'unsafe-inline'${adminSources}${toolbarStyle}`
      : `style-src 'self'${toolbarStyle}`,
    isAdmin
      ? `style-src-elem 'self' 'unsafe-inline'${adminSources}${toolbarStyle}`
      : `style-src-elem 'self'${toolbarStyle}`,
    "style-src-attr 'unsafe-inline'",
    // React does not use inline event-handler attributes; blocking them closes
    // the most common use of `unsafe-inline` without affecting the app.
    "script-src-attr 'none'",
    // `data:` and `blob:` cover admin thumbnails and the DOCX viewer's images;
    // the Blob host covers media uploaded on Vercel. The admin additionally
    // requests the signed-in user's Gravatar and Monaco's codicon images.
    `img-src 'self' data: blob: ${VERCEL_BLOB_ORIGIN}${publicImageSources}${adminImages}${toolbarImages}`,
    `font-src 'self' data:${adminSources}${toolbarFonts}`,
    `connect-src ${[...new Set(connectSources)].join(' ')}${publicConnectSources}${adminSources}${toolbarConnect}`,
    "media-src 'self' blob:",
    `worker-src 'self' blob:${adminSources}`,
    "manifest-src 'self'",
    // The admin frames its own origin for Payload's Live Preview. Public pages
    // only need reCAPTCHA's challenge frame.
    `frame-src ${isAdmin ? "'self'" : 'https://www.google.com'}${toolbarFrame}`,
    // Public pages allow only their own origin as an ancestor so Payload's
    // Live Preview can frame the page being edited. The admin itself stays
    // un-frameable. Cross-origin framing remains blocked on both surfaces.
    `frame-ancestors ${isAdmin ? "'none'" : "'self'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ]

  if (isHttps) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}
