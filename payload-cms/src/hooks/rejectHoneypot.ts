import type { CollectionBeforeChangeHook } from 'payload'
import { TURNSTILE_MESSAGES, verifyTurnstileToken } from '@/utilities/verifyTurnstile'

const honeypotFieldName = 'website'
const turnstileFieldName = 'turnstile-token'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^\+?[0-9][0-9 ()-]{6,19}$/

export const rejectHoneypot: CollectionBeforeChangeHook = async ({ data, req }) => {
  const submissionData = data?.submissionData
  const honeypot = submissionData?.find(
    (field: { field: string; value?: unknown }) => field.field === honeypotFieldName,
  )?.value

  if (typeof honeypot === 'string' && honeypot.trim()) {
    throw new Error('Invalid form submission')
  }

  const formID = typeof data?.form === 'string' ? data.form : data?.form?.id
  if (!formID || !Array.isArray(submissionData)) return data

  const form = await req.payload.findByID({ collection: 'forms', depth: 0, id: formID })
  const formFieldNames = new Set(
    (form.fields || [])
      .map((field) => ('name' in field ? field.name : undefined))
      .filter((name): name is string => Boolean(name)),
  )
  if (!['full-name', 'email', 'message'].every((name) => formFieldNames.has(name))) return data

  const valueFor = (name: string) => submissionData.find((field) => field.field === name)?.value
  const email = valueFor('email')
  const phone = valueFor('phone')
  const turnstileToken = valueFor(turnstileFieldName)

  if (typeof email !== 'string' || !emailPattern.test(email.trim())) {
    throw new Error('Please provide a valid email address.')
  }
  if (
    phone !== undefined &&
    phone !== '' &&
    (typeof phone !== 'string' || !phonePattern.test(phone.trim()))
  ) {
    throw new Error('Please provide a valid phone number.')
  }
  if (typeof turnstileToken !== 'string' || !turnstileToken.trim()) {
    throw new Error(TURNSTILE_MESSAGES.missingToken)
  }

  const verification = await verifyTurnstileToken(turnstileToken)
  if (!verification.ok) {
    throw new Error(verification.message)
  }

  return {
    ...data,
    submissionData: submissionData.filter(
      (field) => field.field !== honeypotFieldName && field.field !== turnstileFieldName,
    ),
  }
}
