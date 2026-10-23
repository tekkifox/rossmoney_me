type RecaptchaResponse = {
  action?: string
  score?: number
  success?: boolean
}

export const verifyRecaptchaToken = async (token: string): Promise<boolean> => {
  const secret = process.env.RECAPTCHA_SECRET_KEY
  if (!secret || !token) return false

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      body: new URLSearchParams({ secret, response: token }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    if (!response.ok) return false

    const result = (await response.json()) as RecaptchaResponse
    return result.success === true && result.action === 'contact_form' && (result.score ?? 0) >= 0.5
  } catch {
    return false
  }
}
