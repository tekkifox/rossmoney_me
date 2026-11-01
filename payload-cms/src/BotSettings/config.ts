import type { GlobalBeforeValidateHook, GlobalConfig, Validate } from 'payload'

import { authenticated } from '@/access/authenticated'
import { asRecord } from '@/utilities/json'
import {
  duplicateNames,
  splitBookstackBooks,
  validateAllowedAuthors,
  validateBookstackBooks,
  validateBookstackUrl,
  validateChannelId,
  validateConnectedAccountId,
  validateCredentialName,
  validateHostScope,
  validateRunbookAccess,
  validateSourceChannelMatchesTarget,
  validateSourceName,
  validateSourceTarget,
  validateTargetName,
} from '@/utilities/botSettings'

/** Trim the values an editor can accidentally pad, before anything validates them. */
const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value)

const normaliseTargets: GlobalBeforeValidateHook = ({ data }) => {
  if (!data || !Array.isArray(data.targets)) {
    return data
  }

  return {
    ...data,
    targets: data.targets.map((row: unknown) => {
      const target = asRecord(row)
      const bookstack = asRecord(target.bookstack)
      const books = typeof bookstack.books === 'string' ? bookstack.books : undefined

      return {
        ...target,
        name: trim(target.name),
        channel_id: trim(target.channel_id),
        connected_account_id: trim(target.connected_account_id),
        host_scope: Array.isArray(target.host_scope)
          ? target.host_scope.map((host) => trim(host))
          : target.host_scope,
        bookstack: {
          ...bookstack,
          url: trim(bookstack.url),
          // Canonical comma-separated form, so "a, b" and "a,b" store the same value.
          books: books === undefined ? bookstack.books : splitBookstackBooks(books).join(','),
        },
      }
    }),
  }
}

const normaliseSources: GlobalBeforeValidateHook = ({ data }) => {
  if (!data || !Array.isArray(data.sources)) {
    return data
  }

  return {
    ...data,
    sources: data.sources.map((row: unknown) => {
      const source = asRecord(row)
      const authors = Array.isArray(source.allowed_authors) ? source.allowed_authors : null

      return {
        ...source,
        name: trim(source.name),
        connected_account_id: trim(source.connected_account_id),
        channel_id: trim(source.channel_id),
        target: trim(source.target),
        // Empty rows are dropped: `[]` and `['']` both mean "nobody".
        allowed_authors: authors
          ? authors.map((author) => trim(author)).filter((author) => author !== '')
          : source.allowed_authors,
      }
    }),
  }
}

/**
 * A source's `target` must exist in the same document. Payload arrays cannot
 * reference a sibling, so this reads the document data being validated instead
 * of storing a relationship that could dangle.
 */
const validateSourceTargetField: Validate<string> = (value, { data }) =>
  validateSourceTarget(value, asRecord(data).targets)

/**
 * The source's channel must be the target's channel as well as a valid id.
 * The agent refuses to reply to a different channel, so both are checked here.
 */
const validateSourceChannelField: Validate<string> = (value, { data, siblingData }) => {
  const format = validateChannelId(value)
  if (format !== true) {
    return format
  }
  return validateSourceChannelMatchesTarget(value, asRecord(siblingData).target, asRecord(data).targets)
}

/**
 * Configuration for the notification bot.
 *
 * This global holds names, ids and flags — never credentials. The BookStack
 * `token` field is the NAME of a Portainer variable (`vortex`, `operator`) that
 * the agent resolves at run time. The CMS database is replicated, cloned to
 * preview and backed up nightly, so pasting the token itself here would spread
 * it to every copy.
 *
 * The panel validates a target as a whole: reading runbooks requires a URL,
 * books and a credential name, and a URL is only meaningful when runbooks are
 * allowed. Target names are the keys the agent parses, so they must be unique.
 */
export const BotSettings: GlobalConfig = {
  slug: 'bot-settings',
  label: 'Bot settings',
  admin: {
    group: 'Operations',
    description:
      'Notification bot targets, models and flags. Store the NAME of a BookStack credential, never the token: tokens stay in Portainer.',
  },
  access: {
    // Configuration for a machine caller. Only a signed-in admin (or an API key
    // issued to one) may read it; the bot's own read path is GET /api/bot-settings.
    read: authenticated,
    update: authenticated,
  },
  hooks: {
    beforeValidate: [normaliseTargets, normaliseSources],
  },
  fields: [
    {
      name: 'targets',
      type: 'array',
      labels: {
        singular: 'Target',
        plural: 'Targets',
      },
      admin: {
        initCollapsed: true,
        description:
          'One entry per place the bot reports to. The name is the key the agent uses, so it must be unique.',
        components: {
          RowLabel: '@/BotSettings/RowLabel#RowLabel',
        },
      },
      validate: (value) => {
        const duplicates = duplicateNames(value)
        if (duplicates.length > 0) {
          return `Target names must be unique. Duplicated: ${duplicates.join(', ')}.`
        }
        return true
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          validate: validateTargetName,
          admin: {
            description: 'The key the agent uses, for example admin-chat or automations.',
          },
        },
        {
          name: 'channel_id',
          type: 'text',
          required: true,
          validate: validateChannelId,
          admin: {
            description: 'The Discord channel id this target posts to (digits only).',
          },
        },
        {
          name: 'connected_account_id',
          type: 'text',
          required: true,
          validate: validateConnectedAccountId,
          admin: {
            description: 'The Composio connected account the bot acts through.',
          },
        },
        {
          name: 'host_scope',
          type: 'text',
          hasMany: true,
          required: true,
          validate: validateHostScope,
          label: 'Hosts',
          admin: {
            description:
              'At least one hostname this target may report on, for example example.com. An empty list is refused when the agent loads its configuration.',
          },
        },
        {
          name: 'allow_content',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: 'Allow this target to read published site content.',
          },
        },
        {
          name: 'allow_runbooks',
          type: 'checkbox',
          defaultValue: false,
          validate: (value, { siblingData }) =>
            validateRunbookAccess(value === true, asRecord(siblingData).bookstack),
          admin: {
            description:
              'Allow this target to read its BookStack wiki. Needs a URL, books and a credential name below.',
          },
        },
        {
          name: 'bookstack',
          type: 'group',
          label: 'BookStack',
          admin: {
            description:
              'The wiki this target may read. The credential field holds a name from Portainer, not the token.',
          },
          fields: [
            {
              name: 'url',
              type: 'text',
              validate: validateBookstackUrl,
              admin: {
                description: 'Base URL of the instance, for example https://bookstack.example.com. Must be https://.',
              },
            },
            {
              name: 'books',
              type: 'text',
              validate: validateBookstackBooks,
              admin: {
                description:
                  'Comma-separated book slugs or ids, at most 16, for example v-rising,scripts.',
              },
            },
            {
              name: 'token',
              type: 'text',
              validate: validateCredentialName,
              admin: {
                description:
                  'The NAME of the credential only, for example vortex. The agent resolves it to BOOKSTACK_TOKEN_*_<NAME> in Portainer. Never paste the token.',
              },
            },
          ],
        },
      ],
    },
    {
      name: 'sources',
      type: 'array',
      labels: {
        singular: 'Source',
        plural: 'Sources',
      },
      admin: {
        initCollapsed: true,
        description:
          'Inbound Discord messages the bot answers. Each source maps a channel to one of the targets above.',
        components: {
          RowLabel: '@/BotSettings/SourceRowLabel#SourceRowLabel',
        },
      },
      validate: (value) => {
        const duplicates = duplicateNames(value)
        if (duplicates.length > 0) {
          return `Source names must be unique. Duplicated: ${duplicates.join(', ')}.`
        }
        return true
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          validate: validateSourceName,
          admin: {
            description: 'The key the agent uses, for example vortex-admin.',
          },
        },
        {
          name: 'connected_account_id',
          type: 'text',
          required: true,
          validate: validateConnectedAccountId,
          admin: {
            description: 'The Composio connection that receives the message.',
          },
        },
        {
          name: 'channel_id',
          type: 'text',
          required: true,
          validate: validateSourceChannelField,
          admin: {
            description:
              'The Discord channel id this source listens on (digits only). It must match the channel of the target it names.',
          },
        },
        {
          name: 'allowed_authors',
          type: 'text',
          hasMany: true,
          required: true,
          validate: validateAllowedAuthors,
          label: 'Allowed authors',
          admin: {
            description:
              'At least one Discord user id allowed to use this source. With none, the inbound listener refuses to start.',
          },
        },
        {
          name: 'target',
          type: 'text',
          required: true,
          validate: validateSourceTargetField,
          admin: {
            description:
              'Must name one of the Targets in this document. A source whose target does not exist answers to nothing.',
          },
        },
      ],
    },
    {
      name: 'model',
      type: 'group',
      label: 'Model',
      admin: {
        description: 'The model the agent prefers, and the one it falls back to.',
      },
      fields: [
        {
          name: 'preferred',
          type: 'text',
          admin: {
            description: 'For example opencode/beam-free.',
          },
        },
        {
          name: 'fallback',
          type: 'text',
          admin: {
            description: 'For example opencode-go/deepseek-v4.1-flash.',
          },
        },
      ],
    },
  ],
}
