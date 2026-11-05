import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'

/**
 * Last-known-good ArchView snapshots, one row per resolved source and project.
 *
 * This is an application-owned cache, not editorial content: only the page
 * render and the `/api/architecture` proxy write to it (through the local API,
 * which bypasses access control), and an admin can read it to see what would be
 * served during an outage. There is deliberately no history: a successful live
 * fetch replaces the row in place, so the collection cannot grow.
 */
export const ArchviewSnapshots: CollectionConfig = {
  slug: 'archview-snapshots',
  labels: {
    singular: 'ArchView snapshot',
    plural: 'ArchView snapshots',
  },
  admin: {
    group: 'ArchView',
    useAsTitle: 'key',
    defaultColumns: ['key', 'sourceName', 'project', 'fetchedAt', 'byteSize'],
    description:
      'Last known good ArchView response per source and project. The CMS writes this automatically after a successful live fetch and serves it when ArchView is unreachable.',
  },
  access: {
    // Admins may inspect the cache; every write comes from the application
    // through the local API, which sets `overrideAccess`.
    admin: authenticated,
    read: authenticated,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  timestamps: false,
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Resolved source (id, otherwise origin) plus the project.',
      },
    },
    {
      name: 'sourceId',
      type: 'text',
      index: true,
      admin: {
        description: 'The archview-sources id, when the snapshot came from a collection row.',
      },
    },
    {
      name: 'sourceName',
      type: 'text',
    },
    {
      name: 'origin',
      type: 'text',
      index: true,
    },
    {
      name: 'project',
      type: 'text',
      index: true,
    },
    {
      name: 'snapshot',
      type: 'json',
      required: true,
      admin: {
        description:
          'The complete redacted /api/architecture body, including images, hosts, services, regions, endpoints and telemetry.',
      },
    },
    {
      name: 'fetchedAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'byteSize',
      type: 'number',
      admin: {
        description: 'Size of the stored snapshot in bytes, for operational visibility.',
      },
    },
  ],
}
