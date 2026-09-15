import { NextResponse } from 'next/server'

const CANDIDATE_HOSTS = [
  process.env.ARCHVIEW_URL,
  process.env.ARCHVIEW_HOST && (process.env.ARCHVIEW_HOST.startsWith('http') ? process.env.ARCHVIEW_HOST : `http://${process.env.ARCHVIEW_HOST}`),
  'http://archview:8080',
  'http://localhost:8080',
].filter(Boolean) as string[]

async function tryFetch(url: string, timeoutMs = 5000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
      cache: 'no-store',
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(id)
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const search = url.search || ''

  for (const host of CANDIDATE_HOSTS) {
    const target = `${host.replace(/\/$/, '')}/api/architecture${search}`
    try {
      const res = await tryFetch(target)
      if (!res) continue

      const contentType = res.headers.get('content-type') || ''
      if (!res.ok) {
        // try next host
        continue
      }

      if (contentType.includes('application/json')) {
        const data = await res.json()
        return NextResponse.json(data)
      }

      const text = await res.text()
      return new NextResponse(text, { headers: { 'content-type': contentType } })
    } catch (e) {
      // try next candidate host
      // eslint-disable-next-line no-console
      console.warn('ArchView fetch attempt failed for', host, e instanceof Error ? e.message : e)
      continue
    }
  }

  // All attempts failed — return degraded snapshot
  const message = 'ArchView unreachable from CMS API route'
  return NextResponse.json(
    {
      degraded: true,
      error: message,
      title: 'Degraded architecture snapshot',
      description: 'ArchView unreachable, returning a minimal snapshot',
      services: [],
      nodes: [],
      images: [],
    },
    { status: 200 },
  )
}
