'use client'

import { RowLabelProps, useRowLabel } from '@payloadcms/ui'

type TargetRow = {
  name?: null | string
}

export const RowLabel: React.FC<RowLabelProps> = () => {
  const data = useRowLabel<TargetRow>()

  const label = data?.data?.name
    ? `Target ${data.rowNumber !== undefined ? data.rowNumber + 1 : ''}: ${data.data.name}`
    : 'Target'

  return <div>{label}</div>
}
