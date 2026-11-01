'use client'

import { RowLabelProps, useRowLabel } from '@payloadcms/ui'

type SourceRow = {
  name?: null | string
}

export const SourceRowLabel: React.FC<RowLabelProps> = () => {
  const data = useRowLabel<SourceRow>()

  const label = data?.data?.name
    ? `Source ${data.rowNumber !== undefined ? data.rowNumber + 1 : ''}: ${data.data.name}`
    : 'Source'

  return <div>{label}</div>
}
