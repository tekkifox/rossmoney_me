import { draftMode, headers } from 'next/headers'

import {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  ackeeServerURL,
  shouldEnableAckeeTracker,
} from '@/utilities/ackeeTracker'
import { nonceFromCspHeader } from '@/utilities/contentSecurityPolicy'
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
  nonce?: string
  /** Site origin, from the server-URL helper; a trailing slash is accepted. */
  origin?: string
}

/**
 * The script tag itself. Kept separate from the environment checks so it can
 * be rendered directly in a unit test. `nonce` is required: under
 * `strict-dynamic` a parser-inserted same-origin script is not trusted by
 * `'self'`, only by the nonce on the tag.
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

/**
 * Server wrapper rendered by the public layout. Reads draft mode and the
 * request nonce, then renders nothing unless this is a production request.
 */
export default async function AckeeTracker() {
  const { isEnabled } = await draftMode()

  if (!shouldEnableAckeeTracker({ draft: isEnabled })) {
    return null
  }

  const nonce = nonceFromCspHeader((await headers()).get('content-security-policy'))

  return <AckeeTrackerScript nonce={nonce} />
}
