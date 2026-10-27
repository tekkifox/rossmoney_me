#!/usr/bin/env node
/**
 * Fail on high or critical advisories in production dependencies.
 *
 * The gate runs `pnpm audit --prod` against the lockfile, then keeps only
 * high/critical advisories. An advisory may be accepted only by adding an
 * exact GHSA/CVE entry with a reason and a review date to
 * `.github/audit-allowlist.json`. There is deliberately no wildcard, no
 * severity-wide ignore and no use of `pnpm audit --ignore`.
 *
 * Usage:
 *   node scripts/audit-production.mjs
 *   node scripts/audit-production.mjs --dir <dir> --allow-list <file>
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BLOCKING_SEVERITIES = new Set(['high', 'critical'])
const GHSA_PATTERN = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(PACKAGE_DIR, '..')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function printUsage() {
  console.error(
    'Usage: node scripts/audit-production.mjs [--dir <path>] [--allow-list <path>] [--today <YYYY-MM-DD>]',
  )
}

function parseArgs(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--help' || argument === '-h') {
      printUsage()
      process.exit(0)
    }

    if (argument === '--dir' || argument === '--allow-list' || argument === '--today') {
      const value = argv[index + 1]
      if (!value) fail(`Missing value for ${argument}`)
      options[argument.slice(2)] = value
      index += 1
      continue
    }

    fail(`Unknown argument: ${argument}\n`)
  }

  return options
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function loadAllowList(path, today) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(
        `Allow-list not found: ${path}\n` +
          'Refusing to audit without an explicit allow-list. Create it with an empty "entries" array.',
      )
    }
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(`Allow-list is not valid JSON: ${path}\n${error.message}`)
  }

  if (!parsed || !Array.isArray(parsed.entries)) {
    fail(`Allow-list must be an object with an "entries" array: ${path}`)
  }

  const allowed = new Map()
  const expired = []
  const problems = []

  for (const [index, entry] of parsed.entries.entries()) {
    const where = `${path} entries[${index}]`

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where} must be an object`)
      continue
    }

    const entryProblems = []

    if (
      typeof entry.id !== 'string' ||
      !(GHSA_PATTERN.test(entry.id) || CVE_PATTERN.test(entry.id))
    ) {
      entryProblems.push(`${where}.id must be a GHSA-... or CVE-... identifier`)
    }
    if (typeof entry.package !== 'string' || entry.package.trim() === '' || entry.package === '*') {
      entryProblems.push(
        `${where}.package must be one exact package name (wildcards are not allowed)`,
      )
    }
    if (typeof entry.severity !== 'string' || !BLOCKING_SEVERITIES.has(entry.severity)) {
      entryProblems.push(`${where}.severity must be "high" or "critical"`)
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
      entryProblems.push(`${where}.reason must explain why this advisory is accepted`)
    }
    if (!isIsoDate(entry.reviewBy)) {
      entryProblems.push(`${where}.reviewBy must be a real date in YYYY-MM-DD form`)
    }

    if (entryProblems.length > 0) {
      problems.push(...entryProblems)
      continue
    }

    const key = entry.id.toUpperCase()
    if (allowed.has(key)) {
      problems.push(`${where}.id duplicates ${entry.id}`)
      continue
    }

    if (entry.reviewBy < today) {
      expired.push(entry)
      continue
    }

    allowed.set(key, entry)
  }

  if (problems.length > 0) {
    fail(`Invalid audit allow-list:\n- ${problems.join('\n- ')}`)
  }

  if (expired.length > 0) {
    const details = expired
      .map((entry) => `${entry.id} (${entry.package}) expired on ${entry.reviewBy}`)
      .join('\n- ')
    fail(
      `Audit allow-list entries need review:\n- ${details}\n` +
        'Re-check the advisory, then either renew the review date with a fresh reason or remove the entry.',
    )
  }

  return allowed
}

function pathsFromFindings(findings) {
  if (!Array.isArray(findings)) return []

  const paths = new Set()
  for (const finding of findings) {
    if (!finding || !Array.isArray(finding.paths)) continue
    for (const path of finding.paths) {
      if (typeof path === 'string') paths.add(path)
    }
  }

  return [...paths]
}

function collectAdvisories(report) {
  const advisories = []

  if (report.advisories && typeof report.advisories === 'object') {
    for (const [key, advisory] of Object.entries(report.advisories)) {
      if (!advisory || typeof advisory !== 'object') continue

      advisories.push({
        id:
          typeof advisory.github_advisory_id === 'string'
            ? advisory.github_advisory_id
            : String(key),
        cves: Array.isArray(advisory.cves) ? advisory.cves : [],
        package: advisory.module_name ?? String(key),
        severity: String(advisory.severity ?? 'unknown').toLowerCase(),
        vulnerable: advisory.vulnerable_versions,
        patched: advisory.patched_versions,
        paths: pathsFromFindings(advisory.findings),
      })
    }

    return advisories
  }

  // npm audit v7 shape, in case pnpm changes its JSON report.
  if (report.vulnerabilities && typeof report.vulnerabilities === 'object') {
    for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
      if (!vulnerability || typeof vulnerability !== 'object') continue

      const via = Array.isArray(vulnerability.via) ? vulnerability.via : []
      const viaObjects = via.filter((item) => item && typeof item === 'object')

      if (viaObjects.length === 0) {
        advisories.push({
          id: undefined,
          cves: [],
          package: name,
          severity: String(vulnerability.severity ?? 'unknown').toLowerCase(),
          vulnerable: vulnerability.range,
          patched: undefined,
          paths: [],
        })
        continue
      }

      for (const item of viaObjects) {
        const url = typeof item.url === 'string' ? item.url : ''
        const ghsa = url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)
        advisories.push({
          id: ghsa?.[0],
          cves: [],
          package: name,
          severity: String(item.severity ?? vulnerability.severity ?? 'unknown').toLowerCase(),
          vulnerable: item.range ?? vulnerability.range,
          patched: undefined,
          paths: [],
        })
      }
    }
  }

  return advisories
}

function resolvePnpmSpecifier(directory) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  } catch (error) {
    fail(`Could not read package.json in ${directory}: ${error.message}`)
  }

  const specifier = manifest.packageManager
  if (typeof specifier !== 'string' || !specifier.startsWith('pnpm@')) {
    fail(
      'package.json must declare packageManager as "pnpm@<version>"; ' +
        'the audit runs the same pnpm version as installs.',
    )
  }

  return specifier
}

function runAudit(directory) {
  const args = [resolvePnpmSpecifier(directory), 'audit', '--prod', '--audit-level', 'high', '--json']
  console.log(`Running: corepack ${args.join(' ')}`)
  console.log(`Directory: ${directory}`)

  const result = spawnSync('corepack', args, {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.error) {
    fail(`Could not run pnpm audit: ${result.error.message}`)
  }

  const stdout = result.stdout?.trim() ?? ''
  if (!stdout) {
    const stderr = result.stderr?.trim()
    fail(
      `pnpm audit produced no JSON (exit status ${result.status ?? 'unknown'}).` +
        (stderr ? `\n${stderr}` : ''),
    )
  }

  try {
    return JSON.parse(stdout)
  } catch (error) {
    const stderr = result.stderr?.trim()
    fail(
      `pnpm audit did not return parseable JSON: ${error.message}\n${stdout.slice(0, 2000)}` +
        (stderr ? `\n${stderr}` : ''),
    )
  }
}

function describe(advisory) {
  const id = advisory.id ?? '(no advisory id)'
  const path = advisory.paths.length > 0 ? ` via ${advisory.paths.join(', ')}` : ''
  const vulnerable = advisory.vulnerable ? `; vulnerable ${advisory.vulnerable}` : ''
  const patched = advisory.patched ? `; patched ${advisory.patched}` : ''
  return `${id} ${advisory.package} (${advisory.severity})${path}${vulnerable}${patched}`
}

const options = parseArgs(process.argv.slice(2))
const auditDirectory = resolve(options.dir ?? PACKAGE_DIR)
const allowListPath = resolve(
  options['allow-list'] ?? join(REPO_ROOT, '.github', 'audit-allowlist.json'),
)
const today = options.today ?? new Date().toISOString().slice(0, 10)

if (!isIsoDate(today)) {
  fail(`--today must be a real date in YYYY-MM-DD form, got: ${today}`)
}

const allowList = loadAllowList(allowListPath, today)
console.log(`Allow-list: ${allowListPath} (${allowList.size} active entries)`)

const report = runAudit(auditDirectory)

if (Array.isArray(report.muted) && report.muted.length > 0) {
  fail(
    'pnpm audit reported muted advisories. This gate does not accept blanket ignores; ' +
      'remove --ignore/--ignore-unfixable or any auditConfig ignore list.',
  )
}

const blocking = collectAdvisories(report).filter((advisory) =>
  BLOCKING_SEVERITIES.has(advisory.severity),
)
const allowed = []
const unallowed = []
const usedAllowListIds = new Set()

for (const advisory of blocking) {
  const identifiers = [advisory.id, ...advisory.cves]
    .filter((identifier) => typeof identifier === 'string')
    .map((identifier) => identifier.toUpperCase())

  let entry
  for (const identifier of identifiers) {
    const candidate = allowList.get(identifier)
    if (candidate) {
      entry = candidate
      usedAllowListIds.add(identifier)
      break
    }
  }

  if (entry) {
    allowed.push({ advisory, entry })
  } else {
    unallowed.push(advisory)
  }
}

for (const [id, entry] of allowList) {
  if (!usedAllowListIds.has(id)) {
    console.warn(
      `WARN ${id} (${entry.package}) did not match a high/critical advisory in this audit; remove the entry once the fix has landed.`,
    )
  }
}

for (const { advisory, entry } of allowed) {
  console.log(`ALLOWED ${describe(advisory)} — review by ${entry.reviewBy}`)
}

if (unallowed.length > 0) {
  console.error(
    `\nAudit gate FAILED: ${unallowed.length} high/critical production ` +
      `${unallowed.length === 1 ? 'advisory is' : 'advisories are'} not allow-listed.`,
  )
  for (const advisory of unallowed) {
    console.error(`  ${describe(advisory)}`)
  }
  console.error(
    '\nFix the dependency, or add a scoped entry with a reason and review date to ' +
      '.github/audit-allowlist.json. Do not lower the threshold or ignore a whole severity.',
  )
  process.exit(1)
}

console.log(
  `\nAudit gate PASSED: no high/critical production advisories outside the allow-list` +
    `${allowed.length > 0 ? ` (${allowed.length} explicitly allowed)` : ''}.`,
)
