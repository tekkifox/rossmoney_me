import {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  ackeeServerURL,
  shouldEnableAckeeTracker,
} from '@/utilities/ackeeTracker'
import { resolveServerURL } from '@/utilities/serverURL'

export {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  ACKEE_PATH,
  shouldEnableAckeeTracker,
  type AckeeTrackerEnvironment,
} from '@/utilities/ackeeTracker'

export type AckeeTrackerScriptProps = {
  enabled?: boolean
  /**
   * The served policy of a prerendered public document allows its own scripts,
   * so no nonce is needed. Kept optional for a future dynamic surface.
   */
  nonce?: string
  /** Site origin, from the server-URL helper; a trailing slash is accepted. */
  origin?: string
}

/**
 * The script tag itself. Kept separate from the environment checks so it can
 * be rendered directly in a unit test.
 */
export function AckeeTrackerScript({
  enabled = true,
  nonce,
  origin = resolveServerURL(),
}: AckeeTrackerScriptProps) {
  if (!enabled) {
    return null
  }

  const server = ackeeServerURL(origin)

  return (
    <script
      async
      src={`${server}/tracker.js`}
      nonce={nonce}
      data-ackee-server={server}
      data-ackee-domain-id={ACKEE_DOMAIN_ID}
      data-ackee-opts={ACKEE_OPTS}
    />
  )
}

export type AckeeTrackerProps = {
  /**
   * Draft previews must not post into the production dashboard. The public page
   * passes its own `draft` flag instead of this component reading `draftMode()`,
   * because reading a request-time API here would force every public page
   * dynamic and back to `private, no-store`.
   */
  draft?: boolean
  origin?: string
}

/**
 * Server wrapper rendered by the public page. The production/Vercel/draft gate
 * is synchronous, so it works during a prerendered (ISR) render.
 */
export function AckeeTracker({
  draft = false,
  origin,
}: AckeeTrackerProps = {}) {
  if (!shouldEnableAckeeTracker({ draft })) {
    return null
  }

  return <AckeeTrackerScript origin={origin} />
}

export default AckeeTracker
