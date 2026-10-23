import type { Form } from '@/payload-types'

import { getSafePayload } from './getSafePayload'

/**
 * Load the form rendered by the contact page.
 *
 * Falls back to the first available form so the page keeps working if the
 * contact form is renamed in the admin UI.
 */
export async function getContactForm(): Promise<(Form & { id: number | string }) | null> {
  try {
    const payload = await getSafePayload()

    const byTitle = await payload.find({
      collection: 'forms',
      depth: 0,
      limit: 1,
      pagination: false,
      where: {
        title: {
          equals: 'Contact Form',
        },
      },
    })

    if (byTitle.docs?.[0]) {
      return byTitle.docs[0] as Form & { id: number | string }
    }

    const firstForm = await payload.find({
      collection: 'forms',
      depth: 0,
      limit: 1,
      pagination: false,
    })

    return (firstForm.docs?.[0] as Form & { id: number | string }) || null
  } catch {
    return null
  }
}
