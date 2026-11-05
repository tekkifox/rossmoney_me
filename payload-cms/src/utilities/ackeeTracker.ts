import { isVercelRuntime } from './serverURL'

/**
 * Ackee's public domain id for `www.rossmoney.me`.
 *
 * The tracker posts to the first-party `/a/api` rewrite, so this value is the
 * only thing that ties a visit to the production dashboard. It is deliberately
 * a constant rather than an environment variable: the tracker must never be
 * pointed at a different domain from a preview build.
 */
export const ACKEE_DOMAIN_ID = '3191a3db-fc9b-4663-ac13-e862015111f3'

/**
 * Ackee's `ignoreOwnVisits` default sets an `ackee_ignore` cookie. Visitors
 * must stay cookie-free, so the integration disables it and the operator is
 * excluded another way (a separate browser profile or a network rule).
 */
export const ACKEE_OPTS = '{"ignoreOwnVisits":false}'

/** Path prefix proxied to the Ackee container by `next.config.ts`. */
export const ACKEE_PATH = '/a'

export type AckeeTrackerEnvironment = {
  nodeEnv?: string
  draft?: boolean
  vercel?: boolean
  /**
   * Explicit opt-out for an environment that is not behind the production
   * edge. The CI smoke build sets `ACKEE_ENABLED=false`: the `/a` rewrite
   * targets the `ackee` Docker service, which is absent there, so a rendered
   * tracker would leave a request hanging and block the page's `load` event.
   */
  enabled?: boolean
}

/**
 * The tracker is production-only and never runs in draft/Live Preview or on a
 * Vercel preview. Otherwise a local or CMS preview would post into the
 * production dashboard, and a Vercel build has no `ackee` Docker service to
 * proxy to.
 */
export const shouldEnableAckeeTracker = ({
  nodeEnv = process.env.NODE_ENV,
  draft = false,
  vercel = isVercelRuntime(),
  enabled = process.env.ACKEE_ENABLED !== 'false',
}: AckeeTrackerEnvironment = {}): boolean =>
  enabled && nodeEnv === 'production' && !draft && !vercel

/** Site origin plus the first-party ingestion path, with no double slash. */
export const ackeeServerURL = (origin: string): string =>
  `${origin.replace(/\/+$/, '')}${ACKEE_PATH}`
