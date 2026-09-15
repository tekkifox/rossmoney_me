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
    ['Services', String(services.length || pickFirst(payload, ['servicesCount']) || '0')],
    ['Nodes', String(nodes.length || pickFirst(payload, ['nodeCount']) || '0')],
    ['Images', String(dockerImages.length || pickFirst(payload, ['imagesCount']) || '0')],
  ]
}

export function buildHighlights(payload: AnyObject | null | undefined) {
  const services = normalizeList(pickFirst(payload, ['services', 'components', 'apps']))
  const regions = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']))

  return [
    { label: 'Services', value: services.length ? services.slice(0, 6) : ['Waiting on feed'] },
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
  lines.push('services')
  lines.push(services.length ? services.map((s: any) => `  - ${s}`).join('\n') : '  - awaiting live service list')
  lines.push('')
  // Images: list images with their short description for quick topology context
  lines.push('images')
  if (dockerImages.length) {
    lines.push(dockerImages.map((img: any) => `  - ${img.name}${img.description ? ` — ${String(img.description)}` : ''}`).join('\n'))
  } else {
    lines.push('  - No images reported')
  }
  lines.push('')
  // Nodes: list original node identifiers and also show concise system stats (load, memory)
  lines.push('nodes')
  lines.push(nodes.length ? nodes.map((n: any) => `  - ${n}`).join('\n') : '  - awaiting live node list')
  lines.push('')
  lines.push('node stats')
  if (rawNodes.length) {
    const formatBytes = (n: number | null | undefined) => {
      if (!n && n !== 0) return '0 B'
      const bytes = Number(n) || 0
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let idx = 0
      let val = bytes
      while (val >= 1024 && idx < units.length - 1) { val = val / 1024; idx++ }
      return `${Math.round(val * 10) / 10} ${units[idx]}`
    }

    const fmtLoad = (item: any) => {
      const loads = item?.load || item?.loads || item?.loadavg || item?.loadAvg || item?.load_1 || item?.load1 || item?.cpuLoad
      if (Array.isArray(loads) && loads.length) return String(loads.slice(0, 3).join(', '))
      if (typeof loads === 'object') return String(Object.values(loads).slice(0, 3).join(', '))
      if (loads !== undefined && loads !== null) return String(loads)
      // try nested keys
      const l1 = item?.['load.1'] || item?.['load_1']
      if (l1 !== undefined) return String(l1)
      return null
    }

    const fmtMem = (item: any) => {
      const mem = item?.memory || item?.mem || item?.meminfo || item?.Memory
      let total = null
      let used = null
      if (mem && typeof mem === 'object') {
        total = mem.total ?? mem.totalBytes ?? mem.total_memory ?? mem.mem_total
        used = mem.used ?? mem.usedBytes ?? mem.usage ?? mem.mem_used
      }
      total = total ?? item?.memoryTotal ?? item?.memTotal ?? item?.mem_total
      used = used ?? item?.memoryUsed ?? item?.memUsed ?? item?.mem_used
      if (total || used) {
        const t = Number(total) || 0
        const u = Number(used) || 0
        const pct = t > 0 ? Math.round((u / t) * 100) : null
        return { total: t || null, used: u || null, pct }
      }
      return null
    }

    const nodeLines = rawNodes.map((n: any, idx: number) => {
      if (!n) return '  - (unknown)'
      if (typeof n === 'string') return `  - ${n}`
      // Try to resolve a friendly name; fall back to the normalized node name at the same index
      const name = n.name || n.node || n.id || n.host || n.hostname || n.container || nodes[idx] || JSON.stringify(n).slice(0, 24)
      const load = fmtLoad(n)
      const mem = fmtMem(n)
      const parts: string[] = []
      if (load) parts.push(`load: ${load}`)
      if (mem && mem.total !== null) parts.push(`mem: ${formatBytes(mem.used)} / ${formatBytes(mem.total)}${mem.pct !== null ? ` (${mem.pct}%)` : ''}`)
      return `  - ${name}${parts.length ? ' — ' + parts.join(', ') : ''}`
    })

    lines.push(nodeLines.join('\n'))
  } else {
    lines.push('  - awaiting live node list')
  }
  lines.push('')
  lines.push('regions')
  lines.push(regions.length ? regions.map((r: any) => `  - ${r}`).join('\n') : '  - awaiting live region list')

  return lines.join('\n')
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
    .filter((image: any, index: number, list: any[]) => image.name && list.findIndex((entry) => entry.name === image.name) === index)

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
