import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'

/**
 * Admin-only error sink.
 *
 * The public site writes to it through `POST /api/error-report` (a rate-limited,
 * same-origin endpoint); the browser and Next.js server errors both end up
 * here. Nothing in this collection is readable without a signed-in admin, so it
 * is not a public API. Rows are capped and deduplicated by
 * `utilities/errorLogStore.ts`; this file only describes the stored shape.
 */
export const ErrorLogs: CollectionConfig = {
  slug: 'error-logs',
  labels: {
    singular: 'Error log',
    plural: 'Error logs',
  },
  access: {
    // Every operation, including the admin list, requires a session. Public
    // reads and writes are deliberately impossible.
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'message',
    defaultColumns: ['lastSeen', 'level', 'fingerprint', 'occurrences', 'route', 'message'],
    group: 'Operations',
    description:
      'Runtime errors captured from the public site and the Next.js server. Oldest rows are removed automatically at 2,000 entries.',
  },
  // Newest first, with repeats grouped by fingerprint.
  defaultSort: '-lastSeen',
  // The explicit `timestamp`/`lastSeen` fields are the only time values that
  // matter here; Payload's createdAt/updatedAt would duplicate them.
  timestamps: false,
  fields: [
    {
      name: 'level',
      type: 'select',
      required: true,
      defaultValue: 'error',
      index: true,
      options: [
        { label: 'Warning', value: 'warning' },
        { label: 'Error', value: 'error' },
        { label: 'Fatal', value: 'fatal' },
      ],
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'client',
      options: [
        { label: 'Browser', value: 'client' },
        { label: 'React render', value: 'react' },
        { label: 'Server', value: 'server' },
      ],
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
      maxLength: 2000,
    },
    {
      name: 'stack',
      type: 'textarea',
      maxLength: 8000,
      admin: {
        description: 'Scrubbed and truncated to 8,000 characters.',
      },
    },
    {
      name: 'fingerprint',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Short hash used to group repeats. Repeats increment Occurrences.',
        readOnly: true,
      },
    },
    {
      name: 'occurrences',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
    },
    {
      name: 'route',
      type: 'text',
      index: true,
      maxLength: 500,
    },
    {
      name: 'url',
      type: 'text',
      maxLength: 1000,
      admin: {
        description: 'URL without query string or fragment.',
      },
    },
    {
      name: 'environment',
      type: 'text',
      maxLength: 100,
    },
    {
      name: 'release',
      type: 'text',
      maxLength: 100,
      admin: {
        description: 'Commit or deployment identifier, when the platform exposes one.',
      },
    },
    {
      name: 'userAgent',
      type: 'text',
      maxLength: 500,
    },
    {
      name: 'timestamp',
      type: 'date',
      required: true,
      admin: {
        description: 'First occurrence.',
        date: {
          displayFormat: 'dd MMM yyyy HH:mm:ss',
        },
      },
    },
    {
      name: 'lastSeen',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Most recent occurrence.',
        date: {
          displayFormat: 'dd MMM yyyy HH:mm:ss',
        },
      },
    },
  ],
}
