import type { CollectionBeforeChangeHook } from 'payload'

export const rejectHoneypot: CollectionBeforeChangeHook = ({ data }) => {
  const honeypot = data?.submissionData?.find(
    (field: { field?: string; value?: unknown }) => field.field === 'website',
  )?.value

  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    throw new Error('Invalid form submission')
  }

  return data
}
