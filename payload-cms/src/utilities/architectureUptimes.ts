// Docker reports how long a container has been running in its `status` string
// ("Up 3 hours", "Up 2 days"). ArchView forwards that verbatim, but the raw
// snapshot panel is meant to show topology, not how long things have been up.
//
// The API stays untouched: this helper produces a display-only copy for the
// raw dump. The shared payload keeps its uptimes so nothing else changes.

import { asRecord, isObjectLike, type JsonRecord } from '@/utilities/json'

const UPTIME_KEYS = new Set([
  'uptime',
  'uptimeseconds',
  'uptime_seconds',
  'uptimesince',
  'uptime_since',
  'startedat',
  'started_at',
  'starttime',
  'start_time',
  'runningfor',
  'running_for',
  'upsince',
  'up_since',
])

function isUptimeKey(key: string): boolean {
  return UPTIME_KEYS.has(key.toLowerCase())
}

/** Removes uptime-only keys from an object graph, in place. */
function scrubUptimeKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) scrubUptimeKeys(item)
    return
  }
  if (!isObjectLike(value)) return

  for (const key of Object.keys(value)) {
    if (isUptimeKey(key)) {
      delete value[key]
      continue
    }
    scrubUptimeKeys(value[key])
  }
}

/** Removes `status` (the Docker uptime string) from a single container. */
function scrubContainer(container: JsonRecord): void {
  for (const key of Object.keys(container)) {
    if (key.toLowerCase() === 'status' || isUptimeKey(key)) {
      delete container[key]
      continue
    }
    // Docker inspect nests `StartedAt` under `State`; scrub uptimes there too.
    if (key.toLowerCase() === 'state' && isObjectLike(container[key])) {
      scrubUptimeKeys(container[key])
    }
  }
}

/** Finds container arrays anywhere in the payload and scrubs their entries. */
function scrubContainers(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) scrubContainers(item)
    return
  }
  if (!isObjectLike(value)) return

  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === 'containers' && Array.isArray(child)) {
      for (const container of child) {
        if (isObjectLike(container)) scrubContainer(asRecord(container))
      }
    }
    scrubContainers(child)
  }
}

/**
 * Returns a JSON-safe copy of `payload` with container uptimes removed.
 *
 * Only `status` on container objects and uptime-named fields are dropped; every
 * other field is preserved. The input object is never mutated, so callers can
 * keep using the shared payload for the diagram and metric cards.
 */
export function stripUptimesForRawDump(payload: unknown): unknown {
  let copy: unknown
  try {
    copy = JSON.parse(JSON.stringify(payload))
  } catch {
    // Not serialisable (or circular): leave it untouched rather than mutating.
    return payload
  }

  scrubContainers(copy)
  return copy
}
