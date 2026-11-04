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
  const [siteKey, setSiteKey] = useState<string>()

  useEffect(() => {
    let cancelled = false

    const readConfig = async () => {
      try {
        const response = await fetch('/api/turnstile-config', { cache: 'no-store' })
        if (!response.ok) throw new Error('Turnstile configuration is unavailable.')

        const config = (await response.json()) as TurnstileConfigResponse
        if (cancelled) return

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
        if (!cancelled) {
          onState({ state: 'unavailable', message: TURNSTILE_CLIENT_MESSAGES.unavailable })
        }
      }
    }

    void readConfig()

    return () => {
      cancelled = true
    }
  }, [onState])

  useEffect(() => {
    if (!siteKey) return

    let cancelled = false
    let widgetId: string | undefined
    onState({ state: 'loading' })
    onToken(undefined)

    const renderWidget = async () => {
      try {
        const api = await loadTurnstile()
        if (cancelled || !containerRef.current) return

        apiRef.current = api
        widgetId = api.render(containerRef.current, {
          action,
          callback: (token) => onToken(token),
          'error-callback': () => onToken(undefined),
          'expired-callback': () => onToken(undefined),
          'timeout-callback': () => onToken(undefined),
          sitekey: siteKey,
          theme: 'light',
        })
        widgetIdRef.current = widgetId
        onState({ state: 'ready' })
      } catch {
        if (!cancelled) {
          onState({ state: 'unavailable', message: TURNSTILE_CLIENT_MESSAGES.unavailable })
        }
      }
    }

    void renderWidget()

    return () => {
      cancelled = true
      onToken(undefined)
      if (apiRef.current && widgetId) apiRef.current.remove(widgetId)
      widgetIdRef.current = undefined
    }
  }, [action, onState, onToken, resetKey, siteKey])

  return <div className="mb-6" ref={containerRef} />
}
