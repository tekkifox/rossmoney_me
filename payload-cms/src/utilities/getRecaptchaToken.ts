declare global {
  interface Window {
    grecaptcha?: {
      execute: (siteKey: string, options: { action: string }) => Promise<string>
      ready: (callback: () => void) => void
    }
  }
}

export const getRecaptchaToken = async (): Promise<string> => {
  const configResponse = await fetch('/api/recaptcha-config', { cache: 'no-store' })
  const config = (await configResponse.json()) as { error?: string; siteKey?: string }
  const siteKey = config.siteKey

  if (!configResponse.ok || !siteKey) {
    throw new Error(config.error || 'reCAPTCHA is not configured.')
  }

  await loadRecaptchaScript(siteKey)
  const recaptcha = window.grecaptcha
  if (!recaptcha) throw new Error('reCAPTCHA is unavailable. Please try again.')

  return new Promise((resolve, reject) => {
    recaptcha.ready(() => {
      recaptcha
        .execute(siteKey, { action: 'contact_form' })
        .then(resolve)
        .catch(() => reject(new Error('reCAPTCHA verification failed. Please try again.')))
    })
  })
}

let recaptchaScriptLoad: Promise<void> | undefined

const loadRecaptchaScript = (siteKey: string): Promise<void> => {
  if (window.grecaptcha) return Promise.resolve()
  if (recaptchaScriptLoad) return recaptchaScriptLoad

  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('reCAPTCHA is unavailable. Please try again.'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    recaptchaScriptLoad = undefined
    throw error
  })

  recaptchaScriptLoad = load
  return load
}
