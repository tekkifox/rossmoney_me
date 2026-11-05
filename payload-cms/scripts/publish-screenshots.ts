import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

/**
 * Publishes the screenshots captured by `playwright.screenshots.ts`.
 *
 * Order matters: every PNG and every captured page-text file is inspected
 * before the first request goes to BookStack. A finding fails the job without
 * uploading anything, because a screenshot on a public pull request cannot be
 * taken back once it is embedded.
 *
 * BookStack has no named galleries, so images are attached to the configured
 * page with `type=gallery`. The image response's `url` is what gets embedded in
 * the pull request comment.
 */

type ManifestEntry = {
  name: string
  path: string
  url: string
}

type Manifest = {
  entries: ManifestEntry[]
}

type UploadedImage = {
  name: string
  url: string
}

type Finding = {
  file: string
  kind: string
}

const MARKER = '<!-- browser-smoke-screenshots -->'

const env = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR?.trim() || path.resolve(process.cwd(), 'test-results/screenshots')

const BOOKSTACK_URL = env('BOOKSTACK_URL').replace(/\/+$/, '')
const BOOKSTACK_AUTH = `Token ${env('BOOKSTACK_TOKEN_ID')}:${env('BOOKSTACK_TOKEN_SECRET')}`
const BOOKSTACK_PAGE_ID = env('BOOKSTACK_SCREENSHOT_PAGE_ID')
const GITHUB_API_URL = (process.env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(
  /\/+$/,
  '',
)

/**
 * Values that are configured as secrets. They are checked verbatim because a
 * pattern cannot know about a deployment-specific token. Short values are
 * skipped: an id fragment could occur in ordinary page text and would turn the
 * guard into a random failure.
 */
const configuredSecrets = (): Array<[string, string]> => {
  const names = [
    'DEV_MONGO_URI',
    'MONGODB_URI',
    'SCREENSHOT_MONGODB_URI',
    'BOOKSTACK_TOKEN_ID',
    'BOOKSTACK_TOKEN_SECRET',
  ] as const

  return names.flatMap((name) => {
    const value = process.env[name]?.trim()
    return value && value.length >= 8 ? [[name, value] as [string, string]] : []
  })
}

const textPatterns: Array<{ kind: string; pattern: RegExp; pngBytes?: boolean }> = [
  {
    kind: 'raw IPv4 address',
    // Loopback and the documentation ranges are not deployment addresses.
    pattern:
      /\b(?!(?:127\.|0\.0\.0\.0\b|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.))(?:\d{1,3}\.){3}\d{1,3}\b/,
  },
  {
    kind: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    pngBytes: true,
  },
  {
    kind: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    pngBytes: true,
  },
  {
    kind: 'private key block',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    pngBytes: true,
  },
  {
    kind: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    kind: 'credentialed connection string',
    pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s:@/]+:[^\s@/]+@/i,
    pngBytes: true,
  },
  {
    kind: 'provider API token',
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    pngBytes: true,
  },
  {
    kind: 'Authorization header',
    pattern: /\b(?:Bearer|Token)\s+[A-Za-z0-9._:-]{20,}/,
  },
]

const scan = (label: string, content: string, pngBytes = false): Finding[] => {
  const findings: Finding[] = []

  for (const [name, value] of configuredSecrets()) {
    if (content.includes(value)) {
      findings.push({ file: label, kind: `configured secret ${name}` })
    }
  }

  for (const { kind, pattern, pngBytes: appliesToPngBytes } of textPatterns) {
    if (pngBytes && !appliesToPngBytes) continue
    if (pattern.test(content)) {
      findings.push({ file: label, kind })
    }
  }

  return findings
}

/**
 * Reads the text chunks embedded in a PNG. Pixels cannot be OCR'd here; the
 * captured page text covers the strings that were rendered, and this covers
 * the metadata a tool might have written into the file.
 */
const pngTextChunks = (png: Buffer): string => {
  if (png.length < 8 || png.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') {
    throw new Error('not a PNG file')
  }

  const chunks: string[] = []
  let offset = 8

  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > png.length) break

    const data = png.subarray(dataStart, dataEnd)

    if (type === 'tEXt') {
      chunks.push(data.toString('latin1').replace(/\0/g, ': '))
    } else if (type === 'zTXt') {
      const separator = data.indexOf(0)
      if (separator > 0 && separator + 2 <= data.length) {
        try {
          const keyword = data.subarray(0, separator).toString('latin1')
          const text = inflateSync(data.subarray(separator + 2)).toString('utf8')
          chunks.push(`${keyword}: ${text}`)
        } catch {
          // A malformed optional chunk is not a reason to stop publishing.
        }
      }
    } else if (type === 'iTXt') {
      const keywordEnd = data.indexOf(0)
      if (keywordEnd > 0 && keywordEnd + 3 <= data.length) {
        const keyword = data.subarray(0, keywordEnd).toString('latin1')
        const compressed = data[keywordEnd + 1] === 1
        let cursor = keywordEnd + 3
        const languageEnd = data.indexOf(0, cursor)
        if (languageEnd > 0) {
          cursor = languageEnd + 1
          const translatedEnd = data.indexOf(0, cursor)
          if (translatedEnd > 0) {
            const text = data.subarray(translatedEnd + 1)
            chunks.push(
              `${keyword}: ${compressed ? inflateSync(text).toString('utf8') : text.toString('utf8')}`,
            )
          }
        }
      }
    }

    offset = dataEnd + 4
  }

  return chunks.join('\n')
}

const inspectPng = async (file: string): Promise<Finding[]> => {
  const png = await readFile(file)
  const findings: Finding[] = []

  if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') {
    return [{ file, kind: 'not a valid PNG' }]
  }

  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1440) {
    findings.push({ file, kind: `PNG is only ${width}px wide` })
  }
  if (height < 1) {
    findings.push({ file, kind: 'PNG has no height' })
  }

  // Raw bytes catch a secret a tool embedded in the file. IPv4 is deliberately
  // not scanned here: compressed pixel data can contain byte sequences that
  // look like an address, and the text file is the reliable place to look.
  findings.push(...scan(file, png.toString('latin1'), true))

  try {
    findings.push(...scan(`${file} (metadata)`, pngTextChunks(png)))
  } catch (error) {
    findings.push({
      file,
      kind: error instanceof Error ? error.message : 'unreadable PNG metadata',
    })
  }

  return findings
}

const readManifest = async (): Promise<Manifest> => {
  const raw = await readFile(path.join(SCREENSHOT_DIR, 'manifest.json'), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Manifest).entries)
  ) {
    throw new Error('screenshot manifest is not valid')
  }

  for (const entry of (parsed as Manifest).entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.name !== 'string' ||
      !/^[a-z0-9][a-z0-9-]*$/.test(entry.name) ||
      typeof entry.path !== 'string' ||
      typeof entry.url !== 'string'
    ) {
      throw new Error('screenshot manifest contains an invalid entry')
    }
  }

  return parsed as Manifest
}

const guardScreenshots = async (manifest: Manifest): Promise<Finding[]> => {
  if (manifest.entries.length === 0) {
    return [{ file: 'manifest.json', kind: 'no screenshots were captured' }]
  }

  const findings: Finding[] = []
  for (const entry of manifest.entries) {
    findings.push(...(await inspectPng(path.join(SCREENSHOT_DIR, `${entry.name}.png`))))

    const textFile = path.join(SCREENSHOT_DIR, `${entry.name}.txt`)
    try {
      findings.push(...scan(textFile, await readFile(textFile, 'utf8')))
    } catch {
      findings.push({ file: textFile, kind: 'captured page text is missing' })
    }
  }

  const unique = new Map<string, Finding>()
  for (const finding of findings) unique.set(`${finding.file}\0${finding.kind}`, finding)
  return [...unique.values()]
}

const uploadImage = async (entry: ManifestEntry): Promise<UploadedImage> => {
  const png = await readFile(path.join(SCREENSHOT_DIR, `${entry.name}.png`))
  const form = new FormData()
  form.append('type', 'gallery')
  form.append('uploaded_to', BOOKSTACK_PAGE_ID)
  form.append('name', `${entry.name}.png`)
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), `${entry.name}.png`)

  const response = await fetch(`${BOOKSTACK_URL}/api/image-gallery`, {
    method: 'POST',
    headers: {
      Authorization: BOOKSTACK_AUTH,
      Accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`BookStack upload for ${entry.name} failed (${response.status}): ${detail}`)
  }

  const body = (await response.json()) as { url?: unknown }
  if (typeof body.url !== 'string' || body.url.trim() === '') {
    throw new Error(`BookStack upload for ${entry.name} returned no url`)
  }

  return { name: entry.name, url: new URL(body.url, `${BOOKSTACK_URL}/`).toString() }
}

const githubToken = (): string | undefined => process.env.GITHUB_TOKEN?.trim() || undefined

const githubFetch = async (
  token: string,
  apiPath: string,
  init: RequestInit = {},
): Promise<Response> => {
  const response = await fetch(`${GITHUB_API_URL}${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers as Record<string, string> | undefined),
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API ${apiPath} failed (${response.status})`)
  }

  return response
}

/** Manual dispatches on a PR branch have no `pull_request` payload. */
const findOpenPullRequest = async (token: string, repository: string): Promise<string | null> => {
  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME
  if (!branch) return null

  const owner = repository.split('/')[0]
  const query = encodeURIComponent(`head=${owner}:${branch}`)
  const response = await githubFetch(
    token,
    `/repos/${repository}/pulls?state=open&${query}&per_page=10`,
  )
  const pulls = (await response.json()) as Array<{ number?: unknown }>
  const matches = pulls.filter((pull) => typeof pull.number === 'number')

  return matches.length === 1 ? String(matches[0].number) : null
}

const commentOnPullRequest = async (
  repository: string,
  pullNumber: string,
  token: string,
  uploaded: UploadedImage[],
): Promise<void> => {
  const body = [
    MARKER,
    '## Browser smoke screenshots',
    '',
    ...uploaded.map((image) => `![${image.name}](${image.url})`),
    '',
    `[PR screenshots gallery](${BOOKSTACK_URL}/link/${BOOKSTACK_PAGE_ID})`,
  ].join('\n')

  const comments: Array<{ id?: unknown; body?: unknown }> = []
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubFetch(
      token,
      `/repos/${repository}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
    )
    const batch = (await response.json()) as Array<{ id?: unknown; body?: unknown }>
    comments.push(...batch)
    if (batch.length < 100) break
  }

  const existing = comments.find(
    (comment) => typeof comment.body === 'string' && comment.body.includes(MARKER),
  )

  const payload = JSON.stringify({ body })
  const headers = { 'Content-Type': 'application/json' }

  if (existing && typeof existing.id === 'number') {
    await githubFetch(token, `/repos/${repository}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: payload,
    })
    console.log(`Updated screenshot comment on pull request #${pullNumber}`)
    return
  }

  await githubFetch(token, `/repos/${repository}/issues/${pullNumber}/comments`, {
    method: 'POST',
    headers,
    body: payload,
  })
  console.log(`Created screenshot comment on pull request #${pullNumber}`)
}

const main = async (): Promise<void> => {
  const manifest = await readManifest()
  const findings = await guardScreenshots(manifest)

  if (findings.length > 0) {
    console.error('::error::screenshots contain material that must not be published:')
    for (const finding of findings) {
      // Never print the matched value: the finding itself may be the secret.
      console.error(`- ${finding.file}: ${finding.kind}`)
    }
    console.error('No images were uploaded.')
    process.exitCode = 1
    return
  }

  const uploaded: UploadedImage[] = []
  for (const entry of manifest.entries) {
    const image = await uploadImage(entry)
    uploaded.push(image)
    console.log(`Uploaded ${entry.path} -> ${image.url}`)
  }

  const token = githubToken()
  const repository = process.env.GITHUB_REPOSITORY?.trim()
  const pullNumber =
    process.env.PR_NUMBER?.trim() ||
    (token && repository ? await findOpenPullRequest(token, repository) : null)

  if (!token || !repository || !pullNumber) {
    console.log('No pull request context; images were uploaded but no comment was posted.')
    return
  }

  await commentOnPullRequest(repository, pullNumber, token, uploaded)
}

await main()
