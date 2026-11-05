import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AckeeTracker, {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  AckeeTrackerScript,
  shouldEnableAckeeTracker,
  type AckeeTrackerProps,
} from '@/components/AckeeTracker'

afterEach(() => {
  cleanup()
  // React hoists `async` scripts into <head>; unmounting the tree does not
  // always remove them, so clear any tracker left from the previous test.
  for (const element of document.querySelectorAll(trackerSelector)) {
    element.remove()
  }
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://www.example.com')
  vi.stubEnv('SERVER_URL', '')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('VERCEL_URL', '')
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
})

const trackerSelector = `script[data-ackee-domain-id="${ACKEE_DOMAIN_ID}"]`

describe('shouldEnableAckeeTracker', () => {
  it('is off outside production, so local previews never post real stats', () => {
    expect(shouldEnableAckeeTracker({ nodeEnv: 'development', draft: false, vercel: false })).toBe(
      false,
    )
    expect(shouldEnableAckeeTracker({ nodeEnv: 'test', draft: false, vercel: false })).toBe(false)
  })

  it('is off in draft mode, so the CMS Live Preview never posts real stats', () => {
    expect(shouldEnableAckeeTracker({ nodeEnv: 'production', draft: true, vercel: false })).toBe(
      false,
    )
  })

  it('is off on Vercel, where the Docker rewrite target does not exist', () => {
    expect(shouldEnableAckeeTracker({ nodeEnv: 'production', draft: false, vercel: true })).toBe(
      false,
    )
  })

  it('is on for a production request outside draft and Vercel', () => {
    expect(shouldEnableAckeeTracker({ nodeEnv: 'production', draft: false, vercel: false })).toBe(
      true,
    )
  })

  it('can be switched off outside the production edge', () => {
    expect(
      shouldEnableAckeeTracker({
        nodeEnv: 'production',
        draft: false,
        vercel: false,
        enabled: false,
      }),
    ).toBe(false)
  })
})

describe('AckeeTracker', () => {
  it('renders nothing outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')

    const { container } = render(React.createElement(AckeeTracker))

    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders nothing for a draft render', () => {
    const { container } = render(
      React.createElement<AckeeTrackerProps>(AckeeTracker, { draft: true }),
    )

    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders nothing when the environment switches the tracker off', () => {
    vi.stubEnv('ACKEE_ENABLED', 'false')

    const { container } = render(React.createElement(AckeeTracker))

    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders the tracker for a prerendered public page without a nonce', () => {
    render(React.createElement(AckeeTracker))

    const script = document.querySelector<HTMLScriptElement>(trackerSelector)

    expect(script, 'the tracker script must be rendered').not.toBeNull()
    expect(script?.getAttribute('src')).toBe('https://www.example.com/a/tracker.js')
    expect(script?.getAttribute('data-ackee-server')).toBe('https://www.example.com/a')
    expect(script?.getAttribute('data-ackee-domain-id')).toBe(ACKEE_DOMAIN_ID)
    expect(script?.getAttribute('data-ackee-opts')).toBe(ACKEE_OPTS)
    // Public documents are served from the ISR cache, so their policy allows
    // same-origin scripts and there is no per-request nonce to carry.
    expect(script?.getAttribute('nonce')).toBeNull()
  })
})

describe('AckeeTrackerScript', () => {
  it('renders nothing when the production gate is closed', () => {
    const { container } = render(
      React.createElement(AckeeTrackerScript, {
        enabled: false,
        origin: 'https://www.example.com',
      }),
    )

    expect(container.childElementCount).toBe(0)
    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders the first-party tracker', () => {
    render(
      React.createElement(AckeeTrackerScript, {
        // A distinct origin keeps React's script-resource cache from treating
        // this as the same element the wrapper test already inserted.
        origin: 'https://component.example.com/',
      }),
    )

    const script = document.querySelector<HTMLScriptElement>(trackerSelector)

    expect(script, 'the tracker script must be rendered').not.toBeNull()
    expect(script?.getAttribute('src')).toBe('https://component.example.com/a/tracker.js')
    expect(script?.getAttribute('data-ackee-server')).toBe('https://component.example.com/a')
    expect(script?.getAttribute('data-ackee-domain-id')).toBe(ACKEE_DOMAIN_ID)
    expect(script?.getAttribute('data-ackee-opts')).toBe(ACKEE_OPTS)
  })
})
