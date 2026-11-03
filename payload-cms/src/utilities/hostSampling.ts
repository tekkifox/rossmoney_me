import { getPayload } from 'payload'
import config from '@payload-config'

import {
  archviewFetch,
  archviewSourceFetch,
  type ArchviewSourceCredentials,
} from './archviewAuth'
import { toArchviewSourceRecord } from './archviewSources'
import { decryptArchviewSecret } from './archviewSourceSecret'

export function shouldRunHostSampler(env: Record<string, string | undefined> = process.env): boolean {
  if (env.HOST_SAMPLER === 'off') return false
  if (env.HOST_SAMPLER === 'on') return true
  return !env.VERCEL
}

let lastPruneAt = 0

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// A failed-login count is only meaningful as a non-negative integer. Anything
// else (missing, null, a string, a fraction) is stored as null so the panel can
// tell "unavailable" apart from a real zero.
const toCount = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
  return v
}

// The upstream breakdown is a list of { user, count } pairs. Entries that are
// not a non-empty username with a non-negative whole-number count are dropped
// rather than failing the sample, and the list is capped so one noisy host
// cannot bloat a row.
const toFailedLoginUsers = (v: unknown): Array<{ user: string; count: number }> => {
  if (!Array.isArray(v)) return []
  const users: Array<{ user: string; count: number }> = []
  for (const raw of v) {
    if (users.length >= 20) break
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const user = typeof entry.user === 'string' ? entry.user.trim() : ''
    const count = toCount(entry.count)
    if (!user || count === null) continue
    users.push({ user, count })
  }
  return users
}

export type HostSampleInput = {
  hostId: string
  hostLabel: string
  sampledAt: string
  metrics: Record<string, unknown>
  /** The upstream `telemetry.hosts` array, when the payload carried one. */
  hosts?: unknown
}

export type HostSampleRecord = {
  host: string
  hostLabel: string
  sampledAt: string
  cpuAvg: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  memoryPercent: number | null
  cpuCores?: number
  loadAvg: number | null
  diskPercent: number | null
  failedLogins: number | null
  failedLoginUsers: Array<{ user: string; count: number }>
  swapPercent: number | null
  processCount: number | null
  hostCount: number | null
  networkRxMB: number | null
  networkTxMB: number | null
  updatedAt: string | null
}

/**
 * The one place a `host-samples` row is shaped. Both writers call this — the
 * ArchView proxy route when a page view fills the cache, and the background
 * sampler — so a field added or validated here applies to both.
 */
export function buildHostSampleRecord({
  hostId,
  hostLabel,
  sampledAt,
  metrics,
  hosts,
}: HostSampleInput): HostSampleRecord {
  // A source is one host's ArchView, so `telemetry.hosts` normally holds a
  // single entry. If a source aggregates several, keep the largest `cpuCount`:
  // an aggregate must not under-report the machine it runs on. A missing or
  // nonsensical count is simply not stored — it never fails the sample.
  const hostList = Array.isArray(hosts) ? hosts : []
  const cpuCores = hostList.reduce<number | null>((largest, host) => {
    const entry = host && typeof host === 'object' ? (host as Record<string, unknown>) : null
    const count = entry ? toNumber(entry.cpuCount) : null
    if (count === null || count <= 0) return largest
    return largest === null || count > largest ? count : largest
  }, null)

  return {
    host: hostId,
    hostLabel,
    sampledAt,
    cpuAvg: toNumber(metrics.cpuAvg),
    memoryUsedBytes: toNumber(metrics.memoryUsedBytes),
    memoryTotalBytes: toNumber(metrics.memoryTotalBytes),
    memoryPercent: toNumber(metrics.memoryPercent),
    ...(cpuCores === null ? {} : { cpuCores }),
    loadAvg: toNumber(metrics.loadAvg),
    diskPercent: toNumber(metrics.diskPercent),
    failedLogins: toCount(metrics.failedLogins),
    failedLoginUsers: toFailedLoginUsers(metrics.failedLoginUsers),
    swapPercent: toNumber(metrics.swapPercent),
    processCount: toNumber(metrics.processCount),
    hostCount: toNumber(metrics.hostCount),
    networkRxMB: toNumber(metrics.networkRxMB),
    networkTxMB: toNumber(metrics.networkTxMB),
    updatedAt:
      metrics.updatedAt === null || metrics.updatedAt === undefined
        ? null
        : new Date(metrics.updatedAt as string | number).toISOString(),
  }
}

export type SampleResult =
  | { status: 'written' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export async function sampleOneSource(
  payload: Awaited<ReturnType<typeof getPayload>>,
  record: {
    id?: string
    name?: string
    origin: string
    project?: string
    credentials?: ArchviewSourceCredentials
  },
): Promise<SampleResult> {
  const log = (msg: string) => {
    if (payload.logger?.info) payload.logger.info(msg)
    else console.log(msg)
  }
  try {
    if (!record.id) {
      log(`host sample: ${record.name ?? record.origin} skipped (no id)`)
      return { status: 'skipped', reason: 'no id' }
    }
    // A project is optional: ArchView answers without one by returning the
    // whole host overview, telemetry included.
    const project = typeof record.project === 'string' ? record.project.trim() : ''
    const init: RequestInit = {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
    const base = `${record.origin.replace(/\/$/, '')}/api/architecture`
    const url = project ? `${base}?project=${encodeURIComponent(project)}` : base
    const res = record.credentials
      ? await archviewSourceFetch(url, init, record.credentials)
      : await archviewFetch(url, init, process.env)
    if (!res) {
      log(`host sample: ${record.name ?? record.origin} skipped (no response)`)
      return { status: 'skipped', reason: 'no response' }
    }
    if (!res.ok) {
      log(`host sample: ${record.name ?? record.origin} skipped (upstream ${res.status})`)
      return { status: 'skipped', reason: `upstream ${res.status}` }
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      log(`host sample: ${record.name ?? record.origin} skipped (non-JSON)`)
      return { status: 'skipped', reason: 'non-JSON' }
    }
    const data = (await res.json()) as {
      telemetry?: { metrics?: Record<string, unknown>; hosts?: unknown }
    }
    const metrics = data?.telemetry?.metrics
    if (!metrics) {
      log(`host sample: ${record.name ?? record.origin} skipped (no metrics)`)
      return { status: 'skipped', reason: 'no metrics' }
    }

    log(`host sample: ${record.name ?? record.origin} fetched${project ? '' : ' (host overview)'}`)
    await payload.create({
      collection: 'host-samples',
      data: buildHostSampleRecord({
        hostId: record.id,
        hostLabel: record.name ?? record.origin,
        sampledAt: new Date().toISOString(),
        metrics,
        hosts: data?.telemetry?.hosts,
      }),
      overrideAccess: true,
    })
    return { status: 'written' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('host sample write failed:', reason)
    return { status: 'failed', reason }
  }
}

export async function sampleAllEnabledHosts(payload?: Awaited<ReturnType<typeof getPayload>>): Promise<void> {
  const p = payload ?? (await getPayload({ config }))
  let written = 0
  let skipped = 0
  let failed = 0
  let total = 0
  const reasons: Record<string, number> = {}
  try {
    const result = await p.db.find({
      collection: 'archview-sources',
      where: { enabled: { equals: true } },
      limit: 1000,
    })
    const rows = (result?.docs ?? result ?? []) as Array<Record<string, unknown>>
    for (const rawRow of rows) {
      total += 1
      const row = { ...rawRow }
      const name = String(row.name ?? row.id ?? 'unknown')
      if (typeof row.clientSecret === 'string' && row.clientSecret.length > 0) {
        try {
          row.clientSecret = decryptArchviewSecret(row.clientSecret)
        } catch {
          skipped += 1
          const reason = 'secret'
          reasons[reason] = (reasons[reason] ?? 0) + 1
          if (p.logger?.warn) p.logger.warn(`host sampling: skipping ${name}: ${reason}`)
          continue
        }
      }
      const record = toArchviewSourceRecord(row)
      if (!record) {
        skipped += 1
        reasons.other = (reasons.other ?? 0) + 1
        continue
      }
      if (!record.id) {
        skipped += 1
        reasons['no id'] = (reasons['no id'] ?? 0) + 1
        if (p.logger?.warn) p.logger.warn(`host sampling: skipping ${name}: no id`)
        continue
      }
      const result = await sampleOneSource(p, record)
      if (result.status === 'written') {
        written += 1
      } else if (result.status === 'skipped') {
        skipped += 1
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1
        if (p.logger?.warn) p.logger.warn(`host sampling: skipping ${name}: ${result.reason}`)
      } else {
        failed += 1
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1
        if (p.logger?.warn) p.logger.warn(`host sampling: failed ${name}: ${result.reason}`)
      }
    }
  } catch (error) {
    console.warn('host sampling sweep failed:', error instanceof Error ? error.message : error)
  }

  const reasonSummary = Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join(', ')
  const msg = `host sampling: ${written} written, ${skipped} skipped${reasonSummary ? ` (${reasonSummary})` : ''}, ${failed} failed, ${total} sources`
  if (p.logger?.info) p.logger.info(msg)
  else console.log(msg)

  // Retention once per day.
  const now = Date.now()
  if (now - lastPruneAt < 24 * 60 * 60 * 1000) return
  lastPruneAt = now
  try {
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
    await p.delete({
      collection: 'host-samples',
      where: { sampledAt: { less_than: cutoff } },
      overrideAccess: true,
    })
  } catch (error) {
    console.warn('host sample retention prune failed:', error instanceof Error ? error.message : error)
  }
}