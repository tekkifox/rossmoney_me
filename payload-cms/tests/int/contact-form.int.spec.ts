import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { contactForm as contactFormData } from '@/endpoints/seed/contact-form'

let payload: Payload
let formID: string

// The FormBlock posts { form, submissionData } to /api/form-submissions.
// Using the local API with overrideAccess: false exercises the same collection
// operation and access control as the public REST endpoint.
describe('Contact form', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    const existing = await payload.find({
      collection: 'forms',
      where: { title: { equals: contactFormData.title } },
      limit: 1,
      depth: 0,
    })

    // payload.config.ts `onInit` seeds the form on a fresh database.
    if (!existing.docs.length) {
      throw new Error(`Expected startup seeding to create "${contactFormData.title}"`)
    }

    formID = existing.docs[0].id
  }, 120_000)

  afterAll(async () => {
    await payload.destroy()
  })

  it('seeds the contact fields the form block renders', async () => {
    const form = await payload.findByID({ collection: 'forms', id: formID, depth: 0 })
    const fieldNames = (form.fields || [])
      .map((field: any) => field.name)
      .filter((name: string | undefined): name is string => Boolean(name))

    expect(fieldNames).toEqual(expect.arrayContaining(['full-name', 'email', 'phone', 'message']))

    const required = (form.fields || [])
      .filter((field: any) => field.required)
      .map((field: any) => field.name)
      .filter(Boolean)

    expect(required).toEqual(expect.arrayContaining(['full-name', 'email', 'message']))
    expect(required).not.toContain('phone')
  })

  it('accepts an unauthenticated submission with every field', async () => {
    const submission = await payload.create({
      collection: 'form-submissions',
      data: {
        form: formID,
        submissionData: [
          { field: 'full-name', value: 'Ada Lovelace' },
          { field: 'email', value: 'ada@example.com' },
          { field: 'phone', value: '01234567890' },
          { field: 'message', value: 'I would like to discuss a website build.' },
        ],
      },
      depth: 0,
      overrideAccess: false,
    })

    expect(submission.id).toBeTruthy()
    expect(submission.form).toBe(formID)
    expect(submission.submissionData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'full-name', value: 'Ada Lovelace' }),
        expect.objectContaining({ field: 'email', value: 'ada@example.com' }),
        expect.objectContaining({ field: 'phone', value: '01234567890' }),
        expect.objectContaining({
          field: 'message',
          value: 'I would like to discuss a website build.',
        }),
      ]),
    )

    const stored = await payload.findByID({
      collection: 'form-submissions',
      id: submission.id,
      depth: 0,
    })

    expect(stored.id).toBe(submission.id)
    expect(stored.form).toBe(formID)
  })

  it('accepts a submission without the optional phone number', async () => {
    const submission = await payload.create({
      collection: 'form-submissions',
      data: {
        form: formID,
        submissionData: [
          { field: 'full-name', value: 'Grace Hopper' },
          { field: 'email', value: 'grace@example.com' },
          { field: 'message', value: 'Please send a day rate for a CMS integration.' },
        ],
      },
      depth: 0,
      overrideAccess: false,
    })

    expect(submission.id).toBeTruthy()
    expect(submission.submissionData).toHaveLength(3)
    expect(submission.submissionData).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ field: 'phone' })]),
    )
  })

  it('rejects a submission without a form reference', async () => {
    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          submissionData: [{ field: 'message', value: 'Orphaned submission' }],
        } as any,
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
