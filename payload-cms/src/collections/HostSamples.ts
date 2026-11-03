import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'

const numericField = (name: string) => ({
  name,
  type: 'number' as const,
})

export const HostSamples: CollectionConfig = {
  slug: 'host-samples',
  labels: {
    singular: 'Host sample',
    plural: 'Host samples',
  },
  access: {
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  admin: {
    group: 'ArchView',
    defaultColumns: ['hostLabel', 'sampledAt', 'cpuAvg', 'memoryPercent', 'loadAvg', 'diskPercent'],
    description: 'Sampled ArchView host metrics, one row per refresh.',
    components: {
      views: {
        list: {
          Component: '@/components/HostUsage',
        },
      },
    },
  },
  defaultSort: '-sampledAt',
  timestamps: false,
  fields: [
    {
      name: 'host',
      type: 'relationship',
      relationTo: 'archview-sources',
      required: false,
      index: true,
    },
    {
      name: 'hostLabel',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'sampledAt',
      type: 'date',
      required: true,
      index: true,
    },
    numericField('cpuAvg'),
    numericField('memoryUsedBytes'),
    numericField('memoryTotalBytes'),
    numericField('memoryPercent'),
    numericField('cpuCores'),
    numericField('loadAvg'),
    numericField('diskPercent'),
    {
      name: 'failedLogins',
      type: 'number',
      admin: {
        description:
          'Count of SSH password failures in the hour before the sample. Null means the host could not read its logs; it is not zero.',
      },
    },
    {
      name: 'failedLoginUsers',
      type: 'array',
      admin: {
        description:
          'Usernames targeted by SSH password failures in the hour before the sample, most-targeted first. Empty means the host could not report a breakdown; older samples have no value.',
      },
      fields: [
        {
          name: 'user',
          type: 'text',
          required: true,
          validate: (value: string | null | undefined) =>
            value === null || value === undefined || value.trim().length > 0 || 'Username must not be empty',
        },
        {
          name: 'count',
          type: 'number',
          required: true,
          min: 0,
          validate: (value: number | null | undefined) =>
            value === null ||
            value === undefined ||
            Number.isInteger(value) ||
            'Count must be a whole number',
        },
      ],
    },
    numericField('swapPercent'),
    numericField('processCount'),
    numericField('hostCount'),
    numericField('networkRxMB'),
    numericField('networkTxMB'),
    {
      name: 'updatedAt',
      type: 'date',
    },
  ],
}