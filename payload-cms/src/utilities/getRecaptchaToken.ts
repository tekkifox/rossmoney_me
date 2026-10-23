declare global {
  interface Window {
    grecaptcha?: {
      execute: (siteKey: string, options: { action: string }) => Promise<string>
      ready: (callback: () => void) => void
    }
  }
}

export const getRecaptchaToken = async (): Promise<string> => {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  if (!siteKey) throw new Error('reCAPTCHA is not configured.')
  if (!window.grecaptcha) throw new Error('reCAPTCHA is unavailable. Please try again.')

  return new Promise((resolve, reject) => {
    window.grecaptcha?.ready(() => {
      window.grecaptcha
        ?.execute(siteKey, { action: 'contact_form' })
        .then(resolve)
        .catch(() => reject(new Error('reCAPTCHA verification failed. Please try again.')))
    })
  })
}
