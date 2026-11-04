'use client'

import { useEffect, useRef, useState } from 'react'

import {
  loadTurnstile,
  TURNSTILE_CLIENT_MESSAGES,
  type TurnstileApi,
} from '@/utilities/turnstile'

export type TurnstileStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'disabled' }
  | { state: 'unavailable'; message: string }

type TurnstileConfigResponse = {
  required?: boolean
  siteKey?: string | null
}

type TurnstileChallengeProps = {
  action: string
  /** Bump this after a failed submission to discard the used token. */
  resetKey: number
  onState: (status: TurnstileStatus) => void
  onToken: (token: string | undefined) => void
}

const MISSING_CONFIGURATION =
  'Form protection is not configured. Please try again later.'

/**
 * Renders the Turnstile widget with the site key served by
 * `/api/turnstile-config`, so the key is read at runtime rather than inlined at
 * build time. A missing key leaves the form alone outside production; in
 * production the parent blocks submission with a readable error instead.
 */
export function TurnstileChallenge({
  action,
  resetKey,
  onState,
  onToken,
}: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<TurnstileApi | undefined>(undefined)
  const widgetIdRef = useRef<string | undefined>(undefined)
  const configCancelledRef = useRef(false)
  const widgetCancelledRef = useRef(false)
  const [siteKey, setSiteKey] = useState<string>()

  useEffect(() => {
    const cancelledRef = configCancelledRef
    cancelledRef.current = false

    const readConfig = async () => {
      try {
        const response = await fetch('/api/turnstile-config', { cache: 'no-store' })
        if (!response.ok) throw new Error('Turnstile configuration is unavailable.')

        const config = (await response.json()) as TurnstileConfigResponse
        if (cancelledRef.current) return

        if (!config.siteKey) {
          onState(
            config.required
              ? { state: 'unavailable', message: MISSING_CONFIGURATION }
              : { state: 'disabled' },
          )
          return
        }

        setSiteKey(config.siteKey)
      } catch {
        if (!cancelledRef.current) {
          onState({ state: 'unavailable', message: TURNSTILE_CLIENT_MESSAGES.unavailable })
        }
      }
    }

    void readConfig()

    return () => {
      cancelledRef.current = true
    }
  }, [onState])

  useEffect(() => {
    if (!siteKey) return

    const cancelledRef2 = widgetCancelledRef
    cancelledRef2.current = false
    onState({ state: 'loading' })
    onToken(undefined)

    const renderWidget = async () => {
      try {
        const api = await loadTurnstile()
        if (cancelledRef2.current || !containerRef.current) return

        apiRef.current = api
        widgetIdRef.current = api.render(containerRef.current, {
          action,
          callback: (token) => onToken(token),
          'error-callback': () => onToken(undefined),
          'expired-callback': () => onToken(undefined),
          'timeout-callback': () => onToken(undefined),
          sitekey: siteKey,
          theme: 'light',
        })
        onState({ state: 'ready' })
      } catch {
        if (!cancelledRef2.current) {
          onState({ state: 'unavailable', message: TURNSTILE_CLIENT_MESSAGES.unavailable })
        }
      }
    }

    void renderWidget()

    return () => {
      cancelledRef2.current = true
      onToken(undefined)
      if (apiRef.current && widgetIdRef.current) apiRef.current.remove(widgetIdRef.current)
      widgetIdRef.current = undefined
    }
  }, [action, onState, onToken, resetKey, siteKey])

  return <div className="mb-6" ref={containerRef} />
}
