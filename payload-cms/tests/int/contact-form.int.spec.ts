import { getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { contactForm as seededContactForm } from '@/endpoints/seed/contact-form'
import { getContactForm } from '@/utilities/getContactForm'

let payload: Payload

describe('Contact form', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    // `onInit` creates the contact form, but the page lookup must stay useful
    // on a database seeded by the destructive seed endpoint as well.
    const existing = await getContactForm()
    if (!existing) {
      await payload.create({ collection: 'forms', data: seededContactForm })
    }
  })

  it('is available to the contact page with the expected fields', async () => {
    const form = await getContactForm()

    expect(form).not.toBeNull()
    expect(form?.title).toBe(seededContactForm.title)

    const fieldNames = (form?.fields || [])
      .map((field) => ('name' in field ? field.name : undefined))
      .filter(Boolean)

    expect(fieldNames).toEqual(expect.arrayContaining(['full-name', 'email', 'message']))
  })

  it('stores a submission with the form fields', async () => {
    const form = await getContactForm()
    expect(form?.id).toBeDefined()

    const submission = await payload.create({
      collection: 'form-submissions',
      data: {
        form: form!.id,
        submissionData: [
          { field: 'full-name', value: 'Test Person' },
          { field: 'email', value: 'test@example.com' },
          { field: 'message', value: 'Hello from the integration test.' },
        ],
      },
    })

    expect(submission.id).toBeDefined()

    const stored = await payload.findByID({
      collection: 'form-submissions',
      id: submission.id,
    })

    expect(stored.submissionData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'full-name', value: 'Test Person' }),
        expect.objectContaining({ field: 'email', value: 'test@example.com' }),
        expect.objectContaining({ field: 'message', value: 'Hello from the integration test.' }),
      ]),
    )
  })
})
