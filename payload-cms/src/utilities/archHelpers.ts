// Server-side helpers to summarise architecture payloads for templates
type AnyObject = { [k: string]: any }

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function pickFirst(payload: AnyObject | null | undefined, keys: string[]) {
  if (!payload) return null
  for (const key of keys) {
    const v = payload[key]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

export function buildFacts(payload: AnyObject | null | undefined): Array<[string, string]> {
  const dockerImages = extractDockerImages(payload)

  const services = normalizeList(pickFirst(payload, ['services', 'components', 'apps']))
  const nodes = normalizeList(pickFirst(payload, ['nodes', 'hosts', 'instances']))

  return [
    ['Environment', String(pickFirst(payload, ['environment', 'env', 'stage']) || 'Unknown')],
    ['Region', String(pickFirst(payload, ['region', 'primaryRegion', 'zone']) || 'Unknown')],
    ['Cluster', String(pickFirst(payload, ['cluster', 'clusterName', 'namespace']) || 'Unknown')],
    ['Updated', String(pickFirst(payload, ['updatedAt', 'lastUpdated', 'syncedAt', 'timestamp']) || 'Unknown')],
    ['Containers', String(services.length || pickFirst(payload, ['servicesCount']) || '0')],
    ['Nodes', String(nodes.length || pickFirst(payload, ['nodeCount']) || '0')],
    ['Images', String(dockerImages.length || pickFirst(payload, ['imagesCount']) || '0')],
  ]
}

export function buildHighlights(payload: AnyObject | null | undefined) {
  const services = normalizeList(pickFirst(payload, ['services', 'components', 'apps']))
  const regions = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']))

  return [
    { label: 'Containers', value: services.length ? services.slice(0, 6) : ['Waiting on feed'] },
    { label: 'Regions', value: regions.length ? regions.slice(0, 6) : ['Unknown'] },
  ]
}

export function renderDiagram(payload: AnyObject | null | undefined) {
  const services = normalizeList(pickFirst(payload, ['services', 'components', 'apps']))
  const rawNodes = asArray(pickFirst(payload, ['nodes', 'hosts', 'instances']))
  const nodes = normalizeList(pickFirst(payload, ['nodes', 'hosts', 'instances']))
  const dockerImages = extractDockerImages(payload)
  const regions = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']))

  const lines: string[] = []
  lines.push('client')
  lines.push('  -> portfolio site')
  lines.push('     -> /api/architecture')
  lines.push('        -> host Go service')
  lines.push('')
  // Containers (previously called "services")
  lines.push('containers')
  lines.push(services.length ? services.map((s: any) => `  - ${s}`).join('\n') : '  - awaiting live container list')
  lines.push('')
  // Images: list images with their short description for quick topology context
  lines.push('images')
  if (dockerImages.length) {
    lines.push(dockerImages.map((img: any) => `  - ${img.name}${img.description ? ` — ${String(img.description)}` : ''}`).join('\n'))
  } else {
    lines.push('  - No images reported')
  }
  lines.push('')
  // 'nodes' removed from telemetry (redundant with containers)
  lines.push('')
  lines.push('regions')
  lines.push(regions.length ? regions.map((r: any) => `  - ${r}`).join('\n') : '  - awaiting live region list')

  return lines.join('\n')
}

export function buildMetrics(payload: AnyObject | null | undefined) {
  // Use per-host parser to produce aggregated metrics
  const hosts = buildHostStats(payload)
  const cpuVals: number[] = []
  let memUsedTotal = 0
  let memTotalTotal = 0
  let memFound = false
  let diskUsedTotal = 0
  let diskTotalTotal = 0
  let diskFound = false
  let networkRxTotal = 0
  let networkTxTotal = 0
  let networkFound = false
  const loadFirstValues: number[] = []
  const osCounts: Record<string, number> = {}

  for (const h of hosts) {
    if (h.cpu !== undefined && h.cpu !== null) cpuVals.push(Number(h.cpu))
    if (h.memoryUsed !== undefined && h.memoryUsed !== null) { memFound = true; memUsedTotal += Number(h.memoryUsed) }
    if (h.memoryTotal !== undefined && h.memoryTotal !== null) { memFound = true; memTotalTotal += Number(h.memoryTotal) }
    if (h.diskUsed !== undefined && h.diskUsed !== null) { diskFound = true; diskUsedTotal += Number(h.diskUsed) }
    if (h.diskTotal !== undefined && h.diskTotal !== null) { diskFound = true; diskTotalTotal += Number(h.diskTotal) }
    if ((h as any).networkRx !== undefined && (h as any).networkRx !== null) { networkRxTotal += Number((h as any).networkRx); networkFound = true }
    if ((h as any).networkTx !== undefined && (h as any).networkTx !== null) { networkTxTotal += Number((h as any).networkTx); networkFound = true }
    if (h.load) {
      // parse first numeric value from comma-separated load
      const first = String(h.load).split(',')[0].trim()
      const n = Number(first)
      if (!Number.isNaN(n)) loadFirstValues.push(n)
    }
    if (h.os) {
      const key = String(h.os)
      osCounts[key] = (osCounts[key] || 0) + 1
    }
  }

  const cpuAvg = cpuVals.length ? Math.round((cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) * 10) / 10 : null
  const memoryPercent = memFound && memTotalTotal > 0 ? Math.round((memUsedTotal / memTotalTotal) * 100) : null
  const diskPercent = diskFound && diskTotalTotal > 0 ? Math.round((diskUsedTotal / diskTotalTotal) * 100) : null
  const networkRxMB = networkFound ? Math.round((networkRxTotal / (1024 * 1024)) * 10) / 10 : null
  const networkTxMB = networkFound ? Math.round((networkTxTotal / (1024 * 1024)) * 10) / 10 : null
  const loadAvg = loadFirstValues.length ? Math.round((loadFirstValues.reduce((a, b) => a + b, 0) / loadFirstValues.length) * 100) / 100 : null
  const loadSample = loadAvg !== null ? String(loadAvg) : null
  const hostCount = hosts.length
  const topOS = Object.keys(osCounts).length ? Object.entries(osCounts).sort((a, b) => b[1] - a[1])[0][0] : null

  return {
    cpuAvg: cpuAvg ?? null,
    memoryUsedBytes: memFound ? memUsedTotal : null,
    memoryTotalBytes: memFound ? memTotalTotal : null,
    memoryPercent: memoryPercent ?? null,
    diskUsedBytes: diskFound ? diskUsedTotal : null,
    diskTotalBytes: diskFound ? diskTotalTotal : null,
    diskPercent: diskPercent ?? null,
    networkRxMB: networkRxMB ?? null,
    networkTxMB: networkTxMB ?? null,
    loadAvg: loadAvg ?? null,
    loadSample: loadSample ?? null,
    hostCount,
    topOS,
  }
}

export function buildHostStats(payload: AnyObject | null | undefined) {
  const rawNodes = asArray(pickFirst(payload, ['nodes', 'hosts', 'instances']))
  const hosts: Array<{ name: string; cpu?: number | null; load?: string | null; memoryUsed?: number | null; memoryTotal?: number | null; memoryPercent?: number | null; diskUsed?: number | null; diskTotal?: number | null; diskPercent?: number | null; os?: string | null; networkRx?: number | null; networkTx?: number | null }> = []

  const parseCpu = (v: any) => {
    if (v === undefined || v === null || v === '') return null
    if (Array.isArray(v) && v.length) {
      const nums = v.map((x: any) => Number(String(x).replace('%', ''))).filter((n: number) => !Number.isNaN(n))
      if (nums.length) return Math.round((nums.reduce((a: number, b: number) => a + b, 0) / nums.length) * 10) / 10
      return null
    }
    if (typeof v === 'object') {
      const vals = Object.values(v).map((x: any) => Number(String(x).replace('%', ''))).filter((n: number) => !Number.isNaN(n))
      if (vals.length) return Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 10) / 10
      return null
    }
    const s = String(v).replace('%', '')
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  const parseMem = (m: any) => {
    if (!m && m !== 0) return { used: null, total: null, pct: null }
    if (typeof m === 'object') {
      const used = Number(m.used ?? m.usage ?? m.usedBytes ?? m.rss ?? m['memory.usage']) || null
      const total = Number(m.total ?? m.totalBytes ?? m.limit ?? m['memory.limit']) || null
      const pct = (used !== null && total) ? (total > 0 ? Math.round((used / total) * 100) : null) : null
      return { used, total, pct }
    }
    const n = Number(m)
    if (!Number.isNaN(n)) return { used: n, total: null, pct: null }
    return { used: null, total: null, pct: null }
  }

  const parseDisk = (d: any) => {
    if (!d && d !== 0) return { used: null, total: null, pct: null }
    // Often disk stats come as objects, arrays, or single numbers
    if (Array.isArray(d) && d.length) {
      // attempt to sum used/total if elements are objects
      let usedSum = 0
      let totalSum = 0
      let found = false
      for (const el of d) {
        if (el && typeof el === 'object') {
          const used = Number(el.used ?? el.usage ?? el.usedBytes ?? el.used_kb ?? el.used_bytes)
          const total = Number(el.total ?? el.size ?? el.totalBytes ?? el.total_kb ?? el.total_bytes)
          if (!Number.isNaN(used)) { usedSum += used; found = true }
          if (!Number.isNaN(total)) { totalSum += total; found = true }
        }
      }
      if (found) {
        const pct = totalSum > 0 ? Math.round((usedSum / totalSum) * 100) : null
        return { used: usedSum || null, total: totalSum || null, pct }
      }
    }
    if (typeof d === 'object') {
      const used = Number(d.used ?? d.usage ?? d.usedBytes ?? d.used_kb ?? d.used_bytes ?? d.avail ?? d.available) || null
      const total = Number(d.total ?? d.size ?? d.totalBytes ?? d.total_kb ?? d.total_bytes ?? d.capacity) || null
      const pct = (used !== null && total) ? (total > 0 ? Math.round((used / total) * 100) : null) : null
      return { used, total, pct }
    }
    const n = Number(d)
    if (!Number.isNaN(n)) return { used: n, total: null, pct: null }
    return { used: null, total: null, pct: null }
  }

  const parseNetwork = (n: any) => {
    if (!n && n !== 0) return { rx: null, tx: null }
    // common shapes: { rxBytes, txBytes } or { rx, tx } or { rx_b, tx_b } or nested per-interface arrays
    if (Array.isArray(n) && n.length) {
      let rxSum = 0
      let txSum = 0
      let found = false
      for (const el of n) {
        if (el && typeof el === 'object') {
          const r = Number(el.rx ?? el.rxBytes ?? el.rx_bytes ?? el.rx_b ?? el.rx_kb ?? el.rx_bytes_total ?? el.receivedBytes ?? el.received ?? el.rx_rate)
          const t = Number(el.tx ?? el.txBytes ?? el.tx_bytes ?? el.tx_b ?? el.tx_kb ?? el.tx_bytes_total ?? el.sentBytes ?? el.sent ?? el.tx_rate)
          if (!Number.isNaN(r)) { rxSum += r; found = true }
          if (!Number.isNaN(t)) { txSum += t; found = true }
        }
      }
      if (found) return { rx: rxSum || null, tx: txSum || null }
    }
    if (typeof n === 'object') {
      const rx = Number(n.rx ?? n.rxBytes ?? n.rx_bytes ?? n.rx_b ?? n.rx_kb ?? n.rx_bytes_total ?? n.rx_rate ?? n.receivedBytes ?? n.received) || null
      const tx = Number(n.tx ?? n.txBytes ?? n.tx_bytes ?? n.tx_b ?? n.tx_kb ?? n.tx_bytes_total ?? n.tx_rate ?? n.sentBytes ?? n.sent) || null
      return { rx, tx }
    }
    const num = Number(n)
    if (!Number.isNaN(num)) return { rx: num, tx: null }
    return { rx: null, tx: null }
  }

  for (const n of rawNodes) {
    if (!n) continue
    if (typeof n === 'string') {
      hosts.push({ name: String(n) })
      continue
    }
    // prefer nested system object when present
    const sys = (n.system && typeof n.system === 'object') ? n.system : n
    const name = sys.hostname || n.name || n.node || n.id || n.host || n.hostname || n.container || JSON.stringify(n).slice(0, 24)
    const cpu = parseCpu(sys.cpu ?? sys.cpuPercent ?? sys.CPUPercent ?? sys.cpu_percent ?? sys.cpuUsage ?? sys.stats?.cpu ?? sys.metrics?.cpu ?? n.cpu ?? n.cpuPercent)
    let load: string | null = null
    const loads = sys?.loadAverage || sys?.load || sys?.loads || sys?.loadavg || sys?.loadAvg || sys?.load_1 || sys?.load1 || sys?.cpuLoad
    if (loads) {
      if (Array.isArray(loads)) load = loads.slice(0, 3).join(', ')
      else if (typeof loads === 'object') load = Object.values(loads).slice(0, 3).join(', ')
      else load = String(loads)
    }

    // if no explicit cpu percent, estimate from loadAverage and cpuCount when possible
    let cpuFinal = cpu
    if ((cpuFinal === null || cpuFinal === undefined) && Array.isArray(sys?.loadAverage) && sys.cpuCount) {
      const first = Number(sys.loadAverage[0])
      const count = Number(sys.cpuCount) || 1
      if (!Number.isNaN(first) && Number.isFinite(first) && count > 0) {
        cpuFinal = Math.round((first / count) * 100 * 10) / 10
      }
    }

    const memParsed = parseMem(sys.memory ?? sys.mem ?? sys.meminfo ?? sys.Memory ?? sys.memoryStats ?? sys.stats?.memory ?? sys.metrics?.memory ?? n.memory)
    const os = (sys.os || sys.platform || sys.osVersion || sys.os_version || sys.kernel || sys.uname || (sys && (sys.platform || sys.system)) || null) as string | null
    const diskParsed = parseDisk(sys.disks ?? sys.disk ?? sys.diskStats ?? sys.storage ?? sys.fs ?? sys.filesystem ?? sys.disk_usage ?? sys.diskUsage ?? sys.metrics?.disk ?? n.disk)
    const netParsed = parseNetwork(sys.network ?? sys.net ?? sys.networkStats ?? sys.net_stats ?? sys.net_io ?? sys.metrics?.network ?? sys.interfaces ?? n.network)

    hosts.push({ name: String(name), cpu: cpuFinal ?? null, load, memoryUsed: memParsed.used, memoryTotal: memParsed.total, memoryPercent: memParsed.pct, diskUsed: diskParsed.used, diskTotal: diskParsed.total, diskPercent: diskParsed.pct, os, networkRx: netParsed.rx, networkTx: netParsed.tx })
  }

  return hosts
}

export function extractDockerImages(payload: AnyObject | null | undefined): Array<{ name: string; tag?: string | null; sizeBytes?: number | null; created?: number | null; description?: string | null; cpuPercent?: number | null; memoryUsedBytes?: number | null; memoryTotalBytes?: number | null; memoryPercent?: number | null }> {
  const docker = payload || {}

  // Try common locations first
  let rawImages = asArray(docker?.images || docker?.Images || docker?.docker?.images || docker?.Docker?.images || payload?.images || [])

  // If nothing found, search shallowly for any `images` array on the payload
  if (rawImages.length === 0 && payload && typeof payload === 'object') {
    for (const k of Object.keys(payload)) {
      const v = (payload as AnyObject)[k]
      if (Array.isArray(v) && k.toLowerCase() === 'images') {
        rawImages = rawImages.concat(v)
      }
    }
  }

  const out = rawImages
    .flatMap((item: any) => {
      if (!item) return []
      if (typeof item === 'string') return [{ name: normalizeImageRef(item) }]
      if (typeof item !== 'object') return []

      const tags = asArray(item.repoTags || item.RepoTags || item.tags || item.Tags)
      const firstTag = tags.find(Boolean)
      let tagValue: string | null = firstTag ? String(firstTag) : null
      let name = tagValue ? normalizeImageRef(tagValue) : ''
      if (!name) {
        const maybe = item.repository || item.Repository || item.image || item.Image || item.name || item.Name || item.id || item.ID
        name = maybe ? String(maybe) : ''
      }

      if (!name) return []

      // Normalize size and created timestamp
      const rawSize = item.sizeBytes ?? item.SizeBytes ?? item.size ?? item.Size
      const sizeBytes = Number(rawSize) || null

      const rawCreated = item.created ?? item.Created
      let createdNum: number | null = null
      if (rawCreated !== undefined && rawCreated !== null && rawCreated !== '') {
        const parsed = Number(rawCreated)
        if (Number.isFinite(parsed) && parsed > 0) {
          // If value looks like seconds (typical Docker low-precision), convert to ms
          createdNum = parsed < 1e12 ? parsed * 1000 : parsed
        } else {
          const parsedDate = Date.parse(String(rawCreated))
          if (!isNaN(parsedDate)) createdNum = parsedDate
        }
      }

      // Collect possible label locations (Docker inspect variants, container engines, etc.)
      const rawLabels = item?.Labels || item?.labels || item?.Config?.Labels || item?.config?.Labels || item?.ContainerConfig?.Labels || item?.container_config?.Labels || {}
      let labels: any = rawLabels || {}
      if (typeof labels === 'string') {
        try {
          labels = JSON.parse(labels)
        } catch (e) {
          labels = { _raw: String(labels) }
        }
      }

      // Helper to look up a label key case-insensitively
      const lookupLabel = (key: string) => {
        if (!labels || typeof labels !== 'object') return undefined
        if (Object.prototype.hasOwnProperty.call(labels, key)) return labels[key]
        const foundKey = Object.keys(labels).find((k) => k.toLowerCase() === key.toLowerCase())
        return foundKey ? labels[foundKey] : undefined
      }

      // Prefer the OCI image description label when present, then fall back to common description fields.
      // Avoid falling back to tagValue because that often duplicates the image name and produces noisy UI.
      const description = lookupLabel('org.opencontainers.image.description') || lookupLabel('org.opencontainers.image.summary') || lookupLabel('description') || lookupLabel('Description') || lookupLabel('summary') || lookupLabel('summaryDescription') || item.description || item.Comment || item.repoDigest || item.RepoDigest || null

      // Attempt to extract runtime metrics (may be present in some ArchView payloads)
      const cpuRaw = item.cpu ?? item.cpuPercent ?? item.CPUPercent ?? item.cpu_percent ?? item.cpuUsage ?? item.stats?.cpu ?? item.metrics?.cpu
      let cpuPercent: number | null = null
      if (cpuRaw !== undefined && cpuRaw !== null && cpuRaw !== '') {
        const s = String(cpuRaw)
        const maybe = s.replace('%', '')
        const n = Number(maybe)
        if (!Number.isNaN(n)) cpuPercent = n
      }

      // Memory: try to find used and total bytes
      const memRaw = item.memory ?? item.mem ?? item.meminfo ?? item.Memory ?? item.memoryStats ?? item.stats?.memory ?? item.metrics?.memory
      let memoryUsedBytes: number | null = null
      let memoryTotalBytes: number | null = null
      let memoryPercent: number | null = null
      if (memRaw !== undefined && memRaw !== null && memRaw !== '') {
        if (typeof memRaw === 'object') {
          memoryUsedBytes = Number(memRaw.used ?? memRaw.usage ?? memRaw.usedBytes ?? memRaw.rss ?? memRaw['memory.usage']) || null
          memoryTotalBytes = Number(memRaw.total ?? memRaw.totalBytes ?? memRaw.limit ?? memRaw['memory.limit']) || null
        } else {
          const n = Number(memRaw)
          if (!Number.isNaN(n)) {
            // If memRaw is a single number, assume it's bytes used
            memoryUsedBytes = n
          }
        }
      }
      if ((memoryUsedBytes || memoryUsedBytes === 0) && (memoryTotalBytes || memoryTotalBytes === 0)) {
        const t = Number(memoryTotalBytes) || 0
        const u = Number(memoryUsedBytes) || 0
        memoryPercent = t > 0 ? Math.round((u / t) * 100) : null
      }

      // If no metrics were directly attached to the image object, try to find metrics elsewhere in the payload
      // that reference this image (common in node/container-centric feeds). We perform a shallow search for
      // objects containing an image reference and cpu/memory stats and try to match by normalized image name.
      const normalize = (s: any) => normalizeImageRef(String(s || ''))
      const targetRef = normalize(tagValue || name)
      if ((cpuPercent === null || memoryPercent === null) && payload && targetRef) {
        const seen = new Set<any>()
        const maxDepth = 4
        let foundMetrics: any = null

        function dfs(obj: any, depth = 0) {
          if (!obj || typeof obj !== 'object' || depth > maxDepth) return
          if (seen.has(obj)) return
          seen.add(obj)
          // Check if this node has an image reference
          const candidateImage = obj.image || obj.Image || obj.imageName || obj.imageRef || obj.repoTags || obj.RepoTags || obj.Repository || obj.repository
          if (candidateImage) {
            const cand = Array.isArray(candidateImage) ? String(candidateImage.find(Boolean) || '') : String(candidateImage)
            if (cand && normalize(cand) === targetRef) {
              // collect cpu/memory if present
              const cRaw = obj.cpu ?? obj.cpuPercent ?? obj.CPUPercent ?? obj.cpu_percent ?? obj.cpuUsage ?? obj.stats?.cpu ?? obj.metrics?.cpu
              const mRaw = obj.memory ?? obj.mem ?? obj.meminfo ?? obj.Memory ?? obj.memoryStats ?? obj.stats?.memory ?? obj.metrics?.memory
              if (cRaw || mRaw) {
                foundMetrics = { cRaw, mRaw }
                return
              }
            }
          }
          for (const k of Object.keys(obj)) {
            const v = obj[k]
            if (v && typeof v === 'object') {
              dfs(v, depth + 1)
              if (foundMetrics) return
            }
            if (Array.isArray(v)) {
              for (const el of v) {
                if (el && typeof el === 'object') { dfs(el, depth + 1); if (foundMetrics) return }
              }
            }
          }
        }

        try { dfs(payload, 0) } catch (e) { /* ignore */ }

        if (foundMetrics) {
          const s = foundMetrics.cRaw
          if (s !== undefined && s !== null && s !== '') {
            const ss = String(s).replace('%', '')
            const nn = Number(ss)
            if (!Number.isNaN(nn)) cpuPercent = nn
          }
          const m = foundMetrics.mRaw
          if (m !== undefined && m !== null && m !== '') {
            if (typeof m === 'object') {
              memoryUsedBytes = Number(m.used ?? m.usage ?? m.usedBytes ?? m.rss ?? m['memory.usage']) || memoryUsedBytes
              memoryTotalBytes = Number(m.total ?? m.totalBytes ?? m.limit ?? m['memory.limit']) || memoryTotalBytes
            } else {
              const nn = Number(m)
              if (!Number.isNaN(nn)) memoryUsedBytes = nn
            }
            if ((memoryUsedBytes || memoryUsedBytes === 0) && (memoryTotalBytes || memoryTotalBytes === 0)) {
              const t = Number(memoryTotalBytes) || 0
              const u = Number(memoryUsedBytes) || 0
              memoryPercent = t > 0 ? Math.round((u / t) * 100) : null
            }
          }
        }
      }

      return [
        {
          name: String(name),
          tag: tagValue,
          sizeBytes,
          created: createdNum,
          description: description || null,
          cpuPercent,
          memoryUsedBytes,
          memoryTotalBytes,
          memoryPercent,
        },
      ]
    })
    // Keep distinct image entries by name+tag so different tags of the same repo are shown separately
    .filter((image: any, index: number, list: any[]) => {
      if (!image || !image.name) return false
      const key = `${image.name}::${image.tag ?? ''}`
      return list.findIndex((entry) => `${entry.name}::${entry.tag ?? ''}` === key) === index
    })

  return out
}

function normalizeImageRef(ref: unknown) {
  const value = String(ref || '').trim()
  if (!value) return ''
  // remove digest after @
  const withoutDigest = value.split('@')[0]
  const lastSlash = withoutDigest.lastIndexOf('/')
  const lastColon = withoutDigest.lastIndexOf(':')
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest
}

function normalizeList(list: any) {
  const arr = asArray(list)
  return arr.map((item) => {
    if (item === null || item === undefined) return ''
    if (typeof item === 'string' || typeof item === 'number') return String(item)
    if (typeof item === 'object') return item.name || item.label || item.title || item.service || item.node || item.region || JSON.stringify(item)
    return ''
  }).filter(Boolean)
}

export function titleFromPayload(payload: AnyObject | null | undefined) {
  return (pickFirst(payload, ['title', 'name', 'service', 'system', 'application']) as string) || 'Live architecture snapshot'
}

export function descriptionFromPayload(payload: AnyObject | null | undefined) {
  return (pickFirst(payload, ['description', 'summary', 'notes', 'detail']) as string) || 'A current view of services, nodes, and release topology.'
}
