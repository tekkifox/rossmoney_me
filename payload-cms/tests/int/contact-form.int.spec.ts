import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/utilities/verifyRecaptcha', () => ({
  verifyRecaptchaToken: vi.fn<() => Promise<boolean>>(async () => true),
}))

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
    const namedFields = (form.fields || []).filter((field) => 'name' in field)
    const fieldNames = namedFields
      .map((field) => field.name)
      .filter((name): name is string => Boolean(name))

    expect(fieldNames).toEqual(expect.arrayContaining(['full-name', 'email', 'phone', 'message']))

    const required = namedFields
      .filter((field) => field.required)
      .map((field) => field.name)
      .filter(Boolean)

    expect(required).toEqual(expect.arrayContaining(['full-name', 'email', 'message']))
    expect(required).not.toContain('phone')

    expect(form.emails).toEqual([
      expect.objectContaining({
        emailFrom: 'dev@rossmoney.me',
        emailTo: 'dev@rossmoney.me',
        replyTo: '{{email}}',
        subject: 'New contact form submission from {{full-name}}',
      }),
    ])
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
          { field: 'website', value: '' },
          { field: 'recaptcha-token', value: 'verified-token' },
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
          { field: 'recaptcha-token', value: 'verified-token' },
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

  it('rejects invalid email and phone values before persistence', async () => {
    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          form: formID,
          submissionData: [
            { field: 'full-name', value: 'Invalid Contact' },
            { field: 'email', value: 'not-an-email' },
            { field: 'phone', value: 'abc' },
            { field: 'message', value: 'Invalid data' },
            { field: 'recaptcha-token', value: 'verified-token' },
          ],
        },
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow('Please provide a valid email address.')

    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          form: formID,
          submissionData: [
            { field: 'full-name', value: 'Invalid Contact' },
            { field: 'email', value: 'valid@example.com' },
            { field: 'phone', value: 'abc' },
            { field: 'message', value: 'Invalid data' },
            { field: 'recaptcha-token', value: 'verified-token' },
          ],
        },
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow('Please provide a valid phone number.')
  })

  it('rejects a contact submission without a verified reCAPTCHA token', async () => {
    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          form: formID,
          submissionData: [
            { field: 'full-name', value: 'Missing Token' },
            { field: 'email', value: 'valid@example.com' },
            { field: 'message', value: 'Missing token' },
          ],
        },
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow('reCAPTCHA verification failed.')
  })

  it('rejects a submission that fills the honeypot field', async () => {
    const before = await payload.find({
      collection: 'form-submissions',
      where: { form: { equals: formID } },
      limit: 0,
      depth: 0,
    })

    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          form: formID,
          submissionData: [
            { field: 'full-name', value: 'Automated Bot' },
            { field: 'email', value: 'bot@example.com' },
            { field: 'message', value: 'Spam submission' },
            { field: 'website', value: 'https://example.com' },
          ],
        },
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow('Invalid form submission')

    const after = await payload.find({
      collection: 'form-submissions',
      where: { form: { equals: formID } },
      limit: 0,
      depth: 0,
    })

    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('rejects a submission without a form reference', async () => {
    await expect(
      payload.create({
        collection: 'form-submissions',
        data: {
          form: '',
          submissionData: [{ field: 'message', value: 'Orphaned submission' }],
        },
        depth: 0,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/form/i)
  })
})
