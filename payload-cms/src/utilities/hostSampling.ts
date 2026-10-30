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

export async function sampleOneSource(
  payload: Awaited<ReturnType<typeof getPayload>>,
  record: { id?: string; name?: string; origin: string; credentials?: ArchviewSourceCredentials },
): Promise<void> {
  try {
    if (!record.id) return
    const init: RequestInit = {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
    const url = `${record.origin.replace(/\/$/, '')}/api/architecture`
    const res = record.credentials
      ? await archviewSourceFetch(url, init, record.credentials)
      : await archviewFetch(url, init, process.env)
    if (!res || !res.ok) return
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) return
    const data = (await res.json()) as { telemetry?: { metrics?: Record<string, unknown> } }
    const metrics = data?.telemetry?.metrics
    if (!metrics) return

    const toNumber = (v: unknown): number | null => {
      if (v === null || v === undefined) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const updatedAt =
      metrics.updatedAt === null || metrics.updatedAt === undefined
        ? null
        : new Date(metrics.updatedAt as string | number).toISOString()

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
  } catch (error) {
    console.warn('host sample write failed:', error instanceof Error ? error.message : error)
  }
}

export async function sampleAllEnabledHosts(payload?: Awaited<ReturnType<typeof getPayload>>): Promise<void> {
  const p = payload ?? (await getPayload({ config }))
  let sampled = 0
  let skippedSecret = 0
  let skippedOther = 0
  try {
    const result = await p.db.find({
      collection: 'archview-sources',
      where: { enabled: { equals: true } },
      limit: 1000,
    })
    const rows = (result?.docs ?? result ?? []) as Array<Record<string, unknown>>
    for (const rawRow of rows) {
      const row = { ...rawRow }
      const name = String(row.name ?? row.id ?? 'unknown')
      if (typeof row.clientSecret === 'string' && row.clientSecret.length > 0) {
        try {
          row.clientSecret = decryptArchviewSecret(row.clientSecret)
        } catch (error) {
          skippedSecret += 1
          if (p.logger?.warn) p.logger.warn(`host sampling: skipping ${name}: secret (${error instanceof Error ? error.message : error})`)
          else console.warn(`host sampling: skipping ${name}: secret`)
          continue
        }
      }
      const record = toArchviewSourceRecord(row)
      if (!record) {
        skippedOther += 1
        continue
      }
      await sampleOneSource(p, record)
      sampled += 1
    }
  } catch (error) {
    console.warn('host sampling sweep failed:', error instanceof Error ? error.message : error)
  }

  const msg = `host sampling: ${sampled} sampled, ${skippedSecret} skipped (secret), ${skippedOther} skipped (other)`
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