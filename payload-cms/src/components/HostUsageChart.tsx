'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export type SeriesPoint = {
  key: string
  label: string
  day?: string | null
  cpuAvg: number | null
  memoryPercent: number | null
  loadAvg: number | null
  diskPercent: number | null
}

type MetricKey = 'cpuAvg' | 'memoryPercent' | 'loadAvg' | 'diskPercent'

type Panel = {
  dataKey: MetricKey
  title: string
  /** Percent metrics are clamped to 0–100 and get a `%` axis tick suffix. */
  percent?: boolean
  height: number
  stroke: string
  strokeWidth: number
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
  disk: 'var(--theme-elevation-600)',
} as const

/**
 * One panel per metric, CPU first because it moves most, disk last and shorter
 * because it barely moves. Each panel gets its own Y-axis: a shared axis let a
 * single 80 % disk reading squash a 29 % CPU plateau into the bottom pixels.
 */
const PANELS: Panel[] = [
  { dataKey: 'cpuAvg', title: 'CPU %', percent: true, height: 200, stroke: SERIES_STROKE.cpu, strokeWidth: 2 },
  {
    dataKey: 'memoryPercent',
    title: 'Memory %',
    percent: true,
    height: 140,
    stroke: SERIES_STROKE.memory,
    strokeWidth: 2,
  },
  { dataKey: 'loadAvg', title: 'Load', height: 140, stroke: SERIES_STROKE.load, strokeWidth: 2 },
  {
    dataKey: 'diskPercent',
    title: 'Disk %',
    percent: true,
    height: 100,
    stroke: SERIES_STROKE.disk,
    strokeWidth: 1.5,
  },
]

/**
 * Fits the axis to this metric's own range with a little padding, so a narrow
 * band of variation fills the panel instead of hugging the bottom. Constant
 * series still get a visible band around their value; percent metrics never
 * exceed 0–100 and load never goes below zero.
 */
export function seriesDomain(data: SeriesPoint[], dataKey: MetricKey, percent = false): [number, number] {
  const values = data
    .map((point) => point[dataKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (values.length === 0) return percent ? [0, 100] : [0, 1]

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  // Averaging buckets can leave a "constant" series with a floating-point
  // span of ~1e-14, which used to collapse the axis to two unreadable ticks.
  // Treat anything below one unit of meaningful change as constant and give it
  // a visible band around the value.
  const minSpan = percent ? 1 : 0.1
  const pad = span < minSpan ? minSpan : span * 0.15

  let low = min - pad
  let high = max + pad
  low = Math.max(0, low)
  if (percent) high = Math.min(100, high)
  if (high - low < 0.2) high = low + 0.2

  return [Number(low.toFixed(2)), Number(high.toFixed(2))]
}

const asNumber = (value: string | number | undefined): number =>
  typeof value === 'number' ? value : Number(value ?? 0)

function MetricPanel({ data, panel }: { data: SeriesPoint[]; panel: Panel }) {
  // A single bucket cannot draw a line, and with `dot={false}` it draws nothing
  // at all. Show dots whenever points are few so sparse ranges stay visible.
  const dot = data.length <= 30 ? { r: 2 } : false
  const hasDays = data.some((point) => typeof point.day === 'string')
  const pointByKey = new Map(data.map((point) => [point.key, point]))
  const dayTicks: string[] = []
  if (hasDays) {
    let start = 0
    for (let i = 0; i <= data.length; i += 1) {
      const day = data[i]?.day
      const prevDay = data[start]?.day
      if (i < data.length && day === prevDay) continue
      if (typeof prevDay === 'string') {
        const mid = start + Math.floor((i - 1 - start) / 2)
        dayTicks.push(data[mid]!.key)
      }
      start = i
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{panel.title}</h3>
      <div style={{ width: '100%', height: panel.height + (hasDays ? 20 : 0) }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: hasDays ? 24 : 0, left: 0 }}>
            <CartesianGrid stroke="var(--theme-border-color)" />
            <XAxis
              dataKey="key"
              stroke="var(--theme-border-color)"
              interval="preserveStartEnd"
              minTickGap={30}
              height={hasDays ? 28 : 30}
              tick={(props: { x?: string | number; y?: string | number; payload?: { value?: unknown } }) => {
                const point = pointByKey.get(String(props.payload?.value ?? ''))
                return (
                  <g transform={`translate(${asNumber(props.x)},${asNumber(props.y)})`}>
                    <text x={0} y={0} dy={12} textAnchor="middle" fill="currentColor" fontSize={11}>
                      {point?.label ?? ''}
                    </text>
                  </g>
                )
              }}
            />
            {hasDays && (
              <XAxis
                xAxisId="day"
                dataKey="key"
                orientation="bottom"
                axisLine={false}
                tickLine={false}
                interval={0}
                ticks={dayTicks}
                height={20}
                tick={(props: { x?: string | number; y?: string | number; payload?: { value?: unknown } }) => {
                  const point = pointByKey.get(String(props.payload?.value ?? ''))
                  return (
                    <g transform={`translate(${asNumber(props.x)},${asNumber(props.y)})`}>
                      <text
                        x={0}
                        y={0}
                        dy={12}
                        textAnchor="middle"
                        fill="var(--theme-elevation-500)"
                        fontSize={11}
                        fontWeight={600}
                      >
                        {point?.day ?? ''}
                      </text>
                    </g>
                  )
                }}
              />
            )}
            <YAxis
              width={52}
              domain={seriesDomain(data, panel.dataKey, panel.percent)}
              unit={panel.percent ? '%' : undefined}
              stroke="var(--theme-border-color)"
            />
            <Tooltip
              labelFormatter={(_value, payload) => {
                const point = payload?.[0]?.payload as SeriesPoint | undefined
                if (!point) return String(_value)
                return point.day ? `${point.day} ${point.label}` : point.label
              }}
            />
            <Line
              type="monotone"
              dataKey={panel.dataKey}
              name={panel.title}
              stroke={panel.stroke}
              strokeWidth={panel.strokeWidth}
              dot={dot}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function HostUsageChart({ data }: { data: SeriesPoint[] }) {
  return (
    <div>
      {PANELS.map((panel) => (
        <MetricPanel key={panel.dataKey} data={data} panel={panel} />
      ))}
    </div>
  )
}
