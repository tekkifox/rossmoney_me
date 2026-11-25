import type { FormFieldBlock } from '@payloadcms/plugin-form-builder/types'

type BlockType = FormFieldBlock['blockType']

/**
 * WCAG 1.3.5 Identify Input Purpose.
 *
 * The form-builder field types do not carry an `autocomplete` setting, so the
 * token is derived from the field name the editor configured. Contact-form
 * fields seeded today are `full-name`, `email`, `phone` and `message`; the
 * aliases below cover the common names an editor is likely to choose.
 */
const TOKENS_BY_NAME: Record<string, string> = {
  name: 'name',
  'full-name': 'name',
  fullname: 'name',
  'your-name': 'name',
  'first-name': 'given-name',
  firstname: 'given-name',
  'given-name': 'given-name',
  'last-name': 'family-name',
  lastname: 'family-name',
  surname: 'family-name',
  'family-name': 'family-name',
  email: 'email',
  'e-mail': 'email',
  'email-address': 'email',
  phone: 'tel',
  telephone: 'tel',
  tel: 'tel',
  'phone-number': 'tel',
  mobile: 'tel',
  'mobile-number': 'tel',
  organization: 'organization',
  organisation: 'organization',
  company: 'organization',
  employer: 'organization',
  'job-title': 'organization-title',
  'street-address': 'street-address',
  address: 'street-address',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-line3': 'address-line3',
  city: 'address-level2',
  town: 'address-level2',
  state: 'address-level1',
  province: 'address-level1',
  region: 'address-level1',
  country: 'country-name',
  'postal-code': 'postal-code',
  postcode: 'postal-code',
  zip: 'postal-code',
  'zip-code': 'postal-code',
  url: 'url',
  website: 'url',
  'web-site': 'url',
  username: 'username',
  'user-name': 'username',
}

export function autocompleteForField(name?: string, blockType?: BlockType): string | undefined {
  if (!name) return undefined

  const normalized = name.trim().toLowerCase()
  const namedToken = TOKENS_BY_NAME[normalized]
  if (namedToken) return namedToken

  // Fall back to the field block when the editor chose an unusual name.
  if (blockType === 'email') return 'email'
  if (blockType === 'country') return 'country-name'
  if (blockType === 'state') return 'address-level1'

  return undefined
}
