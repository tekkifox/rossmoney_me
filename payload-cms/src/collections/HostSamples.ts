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
    hidden: true,
    defaultColumns: ['hostLabel', 'sampledAt', 'cpuAvg', 'memoryPercent', 'loadAvg', 'diskPercent'],
    description: 'Sampled ArchView host metrics, one row per refresh.',
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
    numericField('loadAvg'),
    numericField('diskPercent'),
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