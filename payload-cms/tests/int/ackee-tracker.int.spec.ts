import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ACKEE_DOMAIN_ID,
  ACKEE_OPTS,
  AckeeTrackerScript,
  shouldEnableAckeeTracker,
} from '@/components/AckeeTracker'

afterEach(cleanup)

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
        origin: 'https://www.example.com/',
      }),
    )

    const script = document.querySelector<HTMLScriptElement>(trackerSelector)

    expect(script, 'the tracker script must be rendered').not.toBeNull()
    expect(script?.getAttribute('src')).toBe('https://www.example.com/a/tracker.js')
    expect(script?.getAttribute('data-ackee-server')).toBe('https://www.example.com/a')
    expect(script?.getAttribute('data-ackee-domain-id')).toBe(ACKEE_DOMAIN_ID)
    expect(script?.getAttribute('data-ackee-opts')).toBe(ACKEE_OPTS)
    expect(script?.getAttribute('nonce')).toBe('abc123')
  })
})
