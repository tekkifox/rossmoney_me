import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AckeeTracker, {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  AckeeTrackerScript,
  shouldEnableAckeeTracker,
} from '@/components/AckeeTracker'

const requestState = vi.hoisted(() => ({
  draft: false,
  csp: "default-src 'none'; script-src 'nonce-abc123' 'strict-dynamic' 'self'",
}))

vi.mock('next/headers', () => ({
  draftMode: async () => ({ isEnabled: requestState.draft }),
  headers: async () =>
    new Headers(
      requestState.csp ? { 'content-security-policy': requestState.csp } : {},
    ),
}))

afterEach(() => {
  cleanup()
  // React hoists `async` scripts into <head>; unmounting the tree does not
  // always remove them, so clear any tracker left from the previous test.
  for (const element of document.querySelectorAll(trackerSelector)) {
    element.remove()
  }
  vi.unstubAllEnvs()
  requestState.draft = false
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
})

describe('AckeeTracker', () => {
  it('renders nothing outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const { container } = render(await AckeeTracker())

    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders nothing in draft mode', async () => {
    requestState.draft = true

    const { container } = render(await AckeeTracker())

    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders the nonced tracker for a production request', async () => {
    render(await AckeeTracker())

    const script = document.querySelector<HTMLScriptElement>(trackerSelector)

    expect(script, 'the tracker script must be rendered').not.toBeNull()
    expect(script?.getAttribute('src')).toBe('https://www.example.com/a/tracker.js')
    expect(script?.getAttribute('data-ackee-server')).toBe('https://www.example.com/a')
    expect(script?.getAttribute('data-ackee-domain-id')).toBe(ACKEE_DOMAIN_ID)
    expect(script?.getAttribute('data-ackee-opts')).toBe(ACKEE_OPTS)
    expect(script?.getAttribute('nonce')).toBe('abc123')
  })
})

describe('AckeeTrackerScript', () => {
  it('renders nothing when the production gate is closed', () => {
    const { container } = render(
      React.createElement(AckeeTrackerScript, {
        enabled: false,
        nonce: 'abc123',
        origin: 'https://www.example.com',
      }),
    )

    expect(container.childElementCount).toBe(0)
    expect(container.innerHTML).toBe('')
    expect(document.querySelector(trackerSelector)).toBeNull()
  })

  it('renders the first-party tracker with the request nonce', () => {
    render(
      React.createElement(AckeeTrackerScript, {
        nonce: 'abc123',
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
    expect(script?.getAttribute('nonce')).toBe('abc123')
  })
})
