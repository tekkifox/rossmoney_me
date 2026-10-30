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

export function HostUsageChart({ data }: { data: SeriesPoint[] }) {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="label" stroke="var(--color-border)" />
          <YAxis yAxisId="percent" unit="%" stroke="var(--color-border)" />
          <YAxis yAxisId="load" orientation="right" stroke="var(--color-border)" />
          <Tooltip />
          <Legend />
          <Line yAxisId="percent" type="monotone" dataKey="cpuAvg" name="CPU %" stroke="var(--primary)" dot={false} />
          <Line yAxisId="percent" type="monotone" dataKey="memoryPercent" name="Memory %" stroke="var(--primary)" dot={false} />
          <Line yAxisId="load" type="monotone" dataKey="loadAvg" name="Load" stroke="var(--primary)" dot={false} />
          <Line yAxisId="percent" type="monotone" dataKey="diskPercent" name="Disk %" stroke="var(--primary)" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}