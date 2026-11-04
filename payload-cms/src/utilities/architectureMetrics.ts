/**
 * Formats the host telemetry ArchView returns into the strings the metric
 * cards display.
 *
 * Both the server templates and `ArchitectureClient` use this so the first
 * paint already contains the numbers. Formatting only in the browser was what
 * left the cards showing `N/A` until the first client update.
 */
export type ArchitectureMetricValues = {
  cpu: string
  memory: string
  load: string
  disk: string
  swap: string
  network: string
  hosts: string
  processes: string
  os: string
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}

const hasValue = (value: unknown): value is string | number =>
  value !== null && value !== undefined

const gb = (bytes: unknown): string =>
  (Number(bytes) / (1024 * 1024 * 1024)).toFixed(2)

const percentSuffix = (metrics: UnknownRecord | null, key: string): string =>
  metrics && hasValue(metrics[key]) ? ` (${Number(metrics[key])}%)` : ''

export const architectureMetricsFromPayload = (
  payload: unknown,
): ArchitectureMetricValues => {
  const root = asRecord(payload)
  const telemetry = asRecord(root.telemetry)
  const metrics = Object.keys(asRecord(telemetry.metrics)).length
    ? asRecord(telemetry.metrics)
    : null

  const memory =
    metrics && hasValue(metrics.memoryUsedBytes) && hasValue(metrics.memoryTotalBytes)
      ? `${gb(metrics.memoryUsedBytes)} GB / ${gb(metrics.memoryTotalBytes)} GB${percentSuffix(metrics, 'memoryPercent')}`
      : 'N/A'

  const disk =
    metrics && hasValue(metrics.diskUsedBytes) && hasValue(metrics.diskTotalBytes)
      ? `${gb(metrics.diskUsedBytes)} GB / ${gb(metrics.diskTotalBytes)} GB${percentSuffix(metrics, 'diskPercent')}`
      : 'N/A'

  let swap = 'N/A'
  if (metrics && hasValue(metrics.swapTotalBytes) && hasValue(metrics.swapFreeBytes)) {
    const total = Number(metrics.swapTotalBytes)
    const free = Number(metrics.swapFreeBytes)
    swap = `${gb(total - free)} GB / ${gb(total)} GB${percentSuffix(metrics, 'swapPercent')}`
  }

  let network = 'N/A'
  if (
    metrics &&
    (hasValue(metrics.networkRxMB) || hasValue(metrics.networkTxMB))
  ) {
    const rx = hasValue(metrics.networkRxMB)
      ? `${Number(metrics.networkRxMB).toFixed(1)} MB rx`
      : ''
    const tx = hasValue(metrics.networkTxMB)
      ? `${Number(metrics.networkTxMB).toFixed(1)} MB tx`
      : ''
    network = [rx, tx].filter(Boolean).join(' / ') || 'N/A'
  }

  return {
    cpu: metrics && hasValue(metrics.cpuAvg) ? `${Number(metrics.cpuAvg)}%` : 'N/A',
    memory,
    load:
      metrics && (metrics.loadSample || metrics.loadAvg)
        ? String(metrics.loadSample || metrics.loadAvg)
        : 'N/A',
    disk,
    swap,
    network,
    hosts: metrics && metrics.hostCount ? String(metrics.hostCount) : '0',
    processes:
      metrics && hasValue(metrics.processCount) ? String(metrics.processCount) : 'N/A',
    os: metrics && metrics.topOS ? String(metrics.topOS) : 'N/A',
  }
}
