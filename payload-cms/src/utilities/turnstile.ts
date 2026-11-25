export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export const TURNSTILE_CLIENT_MESSAGES = {
  loading: 'Verification is still loading. Please try again in a moment.',
  missingToken: 'Please complete the verification challenge before submitting.',
  unavailable: 'Verification is unavailable. Please try again.',
} as const

export type TurnstileRenderOptions = {
  sitekey: string
  action?: string
  appearance?: 'always' | 'execute' | 'interaction-only'
  callback?: (token: string) => void
  'error-callback'?: (errorCode?: string) => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  language?: string
}

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptLoad: Promise<TurnstileApi> | undefined

/**
 * Load Cloudflare's explicit-render script once. The script is inserted by the
 * nonced Next.js bundle, so `strict-dynamic` permits it; the CSP host source is
 * the fallback for browsers without `strict-dynamic` support.
 */
export const loadTurnstile = (): Promise<TurnstileApi> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile can only be loaded in the browser.'))
  }
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptLoad) return scriptLoad

  const load = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.src = TURNSTILE_SCRIPT_SRC
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile)
      } else {
        reject(new Error('Turnstile did not initialise.'))
      }
    }
    script.onerror = () => reject(new Error('Turnstile could not be loaded.'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    scriptLoad = undefined
    throw error
  })

  scriptLoad = load
  return load
}
