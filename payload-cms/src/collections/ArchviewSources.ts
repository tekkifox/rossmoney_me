import type {
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionConfig,
  Where,
} from 'payload'

import { authenticated } from '../access/authenticated'
import { asRecord, asString } from '../utilities/json'
import {
  decryptArchviewSecret,
  encryptArchviewSecret,
} from '../utilities/archviewSourceSecret'

/**
 * Keeps at most one default row. The bulk write bypasses document hooks so it
 * cannot recurse, and it intentionally runs before this row is saved.
 */
const enforceSingleDefault: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const next = data as Record<string, unknown>
  if (next.isDefault !== true) {
    return data
  }

  const currentId = asString(asRecord(originalDoc).id)
  const where: Where =
    currentId !== undefined
      ? {
          and: [
            { isDefault: { equals: true } },
            { id: { not_equals: currentId } },
          ],
        }
      : { isDefault: { equals: true } }

  await req.payload.db.updateMany({
    collection: 'archview-sources',
    data: { isDefault: false },
    where,
  })

  return data
}

/**
 * Encrypts a submitted secret before it is written. The admin form cannot read
 * the stored value back (see `decryptStoredSecret`), so an update that leaves
 * the field untouched keeps the existing ciphertext straight from the database.
 */
const encryptSubmittedSecret: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const next = data as Record<string, unknown>
  const submitted = next.clientSecret

  // Store the canonical form so the proxy's lookup (which works in origins)
  // matches regardless of case or an accidental trailing slash.
  if (typeof next.origin === 'string' && next.origin.trim()) {
    try {
      next.origin = new URL(next.origin).origin
    } catch {
      // Validation reports the malformed value.
    }
  }

  if (typeof submitted === 'string' && submitted.length > 0) {
    next.clientSecret = encryptArchviewSecret(submitted)
    return data
  }

  if (operation === 'update') {
    // `originalDoc` has passed through `afterRead`, which strips the secret, so
    // read the ciphertext directly. The adapter does not run hooks.
    const id = asRecord(originalDoc).id
    if (id !== undefined) {
      const stored = await req.payload.db.findOne<{ clientSecret?: string; id: string }>({
        collection: 'archview-sources',
        where: { id: { equals: id } },
      })
      if (typeof stored?.clientSecret === 'string' && stored.clientSecret.length > 0) {
        next.clientSecret = stored.clientSecret
      }
    }
  }

  return data
}

/**
 * Decrypts for the proxy's own lookup, but removes the field from every other
 * read, including the admin's.
 *
 * Field-level `access.read: () => false` would express that, but Payload also
 * uses it to decide whether the field exists in the admin form, which would
 * leave an admin unable to enter a secret. Redacting here keeps the secret out
 * of collection API responses while leaving the input usable.
 */
const decryptStoredSecret: CollectionAfterReadHook = ({ context, doc }) => {
  const next = doc as Record<string, unknown>
  if (typeof next.clientSecret === 'string' && next.clientSecret.length > 0) {
    if (context?.revealArchviewSourceSecret === true) {
      next.clientSecret = decryptArchviewSecret(next.clientSecret)
    } else {
      delete next.clientSecret
    }
  }
  return doc
}

const isHttpsOrigin = (value: unknown): string | true => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'An origin is required'
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter an absolute https:// URL, for example https://archview.example.com'
  }

  if (url.protocol !== 'https:') {
    return 'The origin must use https://'
  }
  if (url.username || url.password) {
    return 'The origin must not contain credentials'
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return 'Enter an origin only, without a path, query or fragment'
  }

  return true
}

const isHttpsUrl = (value: unknown): string | true => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'A token URL is required'
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter an absolute https:// URL, for example https://tenant.auth0.com/oauth/token'
  }

  if (url.protocol !== 'https:') {
    return 'The token URL must use https://'
  }
  if (url.username || url.password) {
    return 'The token URL must not contain credentials'
  }

  return true
}

/**
 * ArchView instances the CMS may call with their own OAuth client credentials.
 *
 * `ARCHVIEW_URL` remains the deployment this app is configured for, and
 * `ARCHVIEW_ALLOWED_SOURCES` still admits extra instances anonymously. A row in
 * this collection instead gives one extra instance its own credentials, so
 * adding an instance no longer means editing environment variables on the CMS.
 */
export const ArchviewSources: CollectionConfig = {
  slug: 'archview-sources',
  labels: {
    singular: 'ArchView source',
    plural: 'ArchView sources',
  },
  admin: {
    group: 'ArchView',
    useAsTitle: 'name',
    defaultColumns: ['name', 'origin', 'audience', 'enabled'],
    description:
      'Additional ArchView instances the CMS can call with their own OAuth client credentials. Sources without a row here are anonymous at most, and only when listed in ARCHVIEW_ALLOWED_SOURCES.',
  },
  access: {
    // Configuration contains credentials: every operation needs a signed-in
    // admin, and the public API can neither read nor write it.
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  hooks: {
    beforeChange: [enforceSingleDefault, encryptSubmittedSecret],
    afterRead: [decryptStoredSecret],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'A short label for this instance, for example "Game servers".',
      },
    },
    {
      name: 'origin',
      type: 'text',
      required: true,
      index: true,
      validate: isHttpsOrigin,
      admin: {
        description:
          'The instance root, for example https://archview.example.com. Its token is only ever sent to this origin.',
      },
    },
    {
      name: 'audience',
      type: 'text',
      required: true,
      admin: {
        description: 'The Auth0 API audience for this ArchView instance.',
      },
    },
    {
      name: 'tokenUrl',
      type: 'text',
      required: true,
      validate: isHttpsUrl,
      admin: {
        description: 'The identity provider token endpoint, for example https://tenant.auth0.com/oauth/token.',
      },
    },
    {
      name: 'clientId',
      type: 'text',
      admin: {
        description:
          'Required together with the client secret. Leave both blank while this source is anonymous.',
      },
    },
    {
      name: 'clientSecret',
      type: 'text',
      admin: {
        disableListColumn: true,
        description:
          'Encrypted at rest with AES-256-GCM using ARCHVIEW_SECRET_KEY. Leave blank when editing to keep the current secret.',
      },
    },
    {
      name: 'scope',
      type: 'text',
      defaultValue: 'archview:read',
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Disabled rows are ignored by the proxy; their credentials are not used.',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'The source used when a page names none. Setting this clears the flag on every other row.',
      },
    },
  ],
}
