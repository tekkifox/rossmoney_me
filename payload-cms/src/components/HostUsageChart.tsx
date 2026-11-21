'use client'

import React from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

export type SeriesPoint = {
  key: string
  label: string
  day?: string | null
  /** Full bucket date and time in UTC, for tooltips (e.g. 2026-10-30 12:33 UTC). */
  tooltipLabel?: string
  count?: number
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
  if (percent) return [0, 100]

  const values = data
    .map((point) => point[dataKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (values.length === 0) return [0, 1]

  const max = Math.max(...values)
  const high = max <= 0 ? 1 : max * 1.1
  return [0, Number(high.toFixed(2))]
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
  const dayBoundaries: string[] = []
  if (hasDays) {
    let start = 0
    for (let i = 0; i <= data.length; i += 1) {
      const day = data[i]?.day
      const prevDay = data[start]?.day
      if (i < data.length && day === prevDay) continue
      if (typeof prevDay === 'string') {
        const mid = start + Math.floor((i - 1 - start) / 2)
        dayTicks.push(data[mid]!.key)
        if (start > 0) dayBoundaries.push(data[start]!.key)
      }
      start = i
    }
  } else if (data.length >= 28 && data.length <= 31) {
    for (let i = 7; i < data.length; i += 7) {
      dayBoundaries.push(data[i]!.key)
    }
  }

  const bucketMs =
    data.length >= 2 ? new Date(data[1]!.key).getTime() - new Date(data[0]!.key).getTime() : 0
  const timeTicks =
    bucketMs === 3 * 60 * 1000
      ? data.filter((point) => new Date(point.key).getUTCMinutes() % 10 === 0).map((point) => point.key)
      : bucketMs === 15 * 60 * 1000
        ? data.filter((point) => new Date(point.key).getUTCMinutes() === 0).map((point) => point.key)
        : bucketMs === 60 * 60 * 1000 && data.length > 24
          ? data.map((point) => point.key)
          : undefined

  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{panel.title}</h3>
      <div style={{ width: '100%', height: panel.height + (hasDays ? 20 : 0) }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: hasDays ? 24 : 0, left: 0 }}>
            <CartesianGrid stroke="var(--theme-border-color)" />
            {dayBoundaries.map((boundary) => (
              <ReferenceLine
                key={boundary}
                x={boundary}
                stroke="var(--theme-elevation-400)"
                strokeDasharray="4 4"
              />
            ))}
            <XAxis
              dataKey="key"
              stroke="var(--theme-border-color)"
              interval={timeTicks && timeTicks.length <= 96 ? 0 : 'preserveStartEnd'}
              ticks={timeTicks}
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
              allowDecimals={!panel.percent}
              tickFormatter={panel.percent ? (value: number) => `${Math.round(value)}` : undefined}
              unit={panel.percent ? '%' : undefined}
              stroke="var(--theme-border-color)"
            />
            <Tooltip
              labelFormatter={(_value, payload) => {
                const point = payload?.[0]?.payload as SeriesPoint | undefined
                if (!point) return String(_value)
                if (point.tooltipLabel) return point.tooltipLabel
                if (point.day) return `${point.day} ${point.label} UTC`
                return point.label.includes(':') ? `${point.label} UTC` : point.label
              }}
              formatter={(value, name) => {
                if (typeof value !== 'number') return [String(value ?? ''), String(name ?? '')]
                return [panel.percent ? `${Math.round(value)}%` : String(value), String(name ?? '')]
              }}
            />
            <Line
              type="monotone"
              dataKey={panel.dataKey}
              name={panel.title}
              stroke={panel.stroke}
              strokeWidth={panel.strokeWidth}
              dot={dot}
              connectNulls={false}
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
