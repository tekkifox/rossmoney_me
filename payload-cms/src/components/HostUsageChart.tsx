'use client'

import React from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export type SeriesPoint = {
  label: string
  cpuAvg: number | null
  memoryPercent: number | null
  loadAvg: number | null
  diskPercent: number | null
}

/**
 * Series colours, taken from the Payload admin theme.
 *
 * The frontend chart palette (`--chart-1`…`--chart-5`) lives in
 * src/styles/tokens.css, which only the public layout imports; the admin never
 * loads it. The admin theme exposes three hue families (success/warning/error)
 * plus the elevation scale, so the four metrics map onto those existing tokens
 * instead of hard-coded hex values.
 */
const SERIES_STROKE = {
  cpu: 'var(--theme-success-500)',
  memory: 'var(--theme-warning-500)',
  load: 'var(--theme-error-500)',
  disk: 'var(--theme-elevation-700)',
} as const

export function HostUsageChart({ data }: { data: SeriesPoint[] }) {
  // A single bucket cannot draw a line, and with `dot={false}` it draws nothing
  // at all. Show dots whenever points are few so sparse ranges stay visible.
  const dot = data.length <= 30 ? { r: 2 } : false

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--theme-border-color)" />
          <XAxis dataKey="label" stroke="var(--theme-border-color)" />
          <YAxis yAxisId="percent" unit="%" stroke="var(--theme-border-color)" />
          <YAxis yAxisId="load" orientation="right" stroke="var(--theme-border-color)" />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="percent"
            type="monotone"
            dataKey="cpuAvg"
            name="CPU %"
            stroke={SERIES_STROKE.cpu}
            dot={dot}
          />
          <Line
            yAxisId="percent"
            type="monotone"
            dataKey="memoryPercent"
            name="Memory %"
            stroke={SERIES_STROKE.memory}
            dot={dot}
          />
          <Line
            yAxisId="load"
            type="monotone"
            dataKey="loadAvg"
            name="Load"
            stroke={SERIES_STROKE.load}
            dot={dot}
          />
          <Line
            yAxisId="percent"
            type="monotone"
            dataKey="diskPercent"
            name="Disk %"
            stroke={SERIES_STROKE.disk}
            dot={dot}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
