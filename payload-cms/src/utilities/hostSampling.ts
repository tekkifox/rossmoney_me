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

export type SampleResult =
  | { status: 'written' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export async function sampleOneSource(
  payload: Awaited<ReturnType<typeof getPayload>>,
  record: { id?: string; name?: string; origin: string; credentials?: ArchviewSourceCredentials },
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
    const init: RequestInit = {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
    const url = `${record.origin.replace(/\/$/, '')}/api/architecture`
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
    const data = (await res.json()) as { telemetry?: { metrics?: Record<string, unknown> } }
    const metrics = data?.telemetry?.metrics
    if (!metrics) {
      log(`host sample: ${record.name ?? record.origin} skipped (no metrics)`)
      return { status: 'skipped', reason: 'no metrics' }
    }

    const toNumber = (v: unknown): number | null => {
      if (v === null || v === undefined) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const updatedAt =
      metrics.updatedAt === null || metrics.updatedAt === undefined
        ? null
        : new Date(metrics.updatedAt as string | number).toISOString()

    log(`host sample: ${record.name ?? record.origin} fetched`)
    await payload.create({
      collection: 'host-samples',
      data: {
        host: record.id,
        hostLabel: record.name ?? record.origin,
        sampledAt: new Date().toISOString(),
        cpuAvg: toNumber(metrics.cpuAvg),
        memoryUsedBytes: toNumber(metrics.memoryUsedBytes),
        memoryTotalBytes: toNumber(metrics.memoryTotalBytes),
        memoryPercent: toNumber(metrics.memoryPercent),
        loadAvg: toNumber(metrics.loadAvg),
        diskPercent: toNumber(metrics.diskPercent),
        swapPercent: toNumber(metrics.swapPercent),
        processCount: toNumber(metrics.processCount),
        hostCount: toNumber(metrics.hostCount),
        networkRxMB: toNumber(metrics.networkRxMB),
        networkTxMB: toNumber(metrics.networkTxMB),
        updatedAt,
      },
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