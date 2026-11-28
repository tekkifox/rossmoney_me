#!/usr/bin/env node
// Guard the CMS image against the pnpm patch trap.
//
// pnpm reads `patchedDependencies` from pnpm-workspace.yaml and applies the
// listed patch files during `pnpm install`. The Dockerfile's deps stage starts
// from a nearly empty context layer, so a patch that is committed to the
// repository but never COPYed into that layer makes the image build fail with
// ERR_PNPM_PATCH_NOT_FOUND, even though the file is right there in the repo.
//
// This script fails when:
//   - a patch named in pnpm-workspace.yaml does not exist at that path, or
//   - payload-cms/Dockerfile does not copy that path into the image before its
//     pnpm install layer.
//
// It is plain Node so CI can run it without installing dependencies.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKSPACE = join(ROOT, 'pnpm-workspace.yaml')
const DOCKERFILE = join(ROOT, 'payload-cms', 'Dockerfile')

/** Patch paths declared under `patchedDependencies` in pnpm-workspace.yaml. */
function readPatchedDependencies(source) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => /^patchedDependencies:\s*(?:#.*)?$/.test(line))
  if (start === -1) return []

  const patches = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue
    // A new top-level key ends the block.
    if (!/^\s/.test(line)) break

    const match = line.match(/^\s+['"]?([^'":]+?)['"]?\s*:\s*['"]?([^'"\s]+)['"]?\s*$/)
    if (match) patches.push({ dependency: match[1], patch: match[2] })
  }
  return patches
}

/** Dockerfile instructions with continuations joined and trailing comments removed. */
function readInstructions(source) {
  const instructions = []
  let current = ''

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd()
    if (!line.trim()) continue
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1).trim()} `
      continue
    }
    instructions.push(`${current}${line}`.trim())
    current = ''
  }
  if (current.trim()) instructions.push(current.trim())

  return instructions
}

function isInstall(instruction) {
  return /^RUN\b/i.test(instruction) && /\bpnpm\b/.test(instruction) && /\binstall\b/.test(instruction)
}

/** True when a COPY maps `patch` to the same relative path inside /app. */
function copyCoversPatch(instruction, patch) {
  const tokens = instruction.split(/\s+/).filter(Boolean)
  if (tokens[0]?.toUpperCase() !== 'COPY') return false
  if (tokens.some((token) => /^--from=/i.test(token))) return false

  const args = tokens.slice(1).filter((token) => !token.startsWith('--'))
  if (args.length < 2) return false

  const destination = args.at(-1)
  for (const source of args.slice(0, -1)) {
    const from = posix.normalize(source.replace(/^\.\//, ''))
    let remainder

    if (from === patch) {
      remainder = ''
    } else if (patch.startsWith(`${from}/`)) {
      remainder = patch.slice(from.length + 1)
    } else {
      continue
    }

    const target = posix.normalize(posix.join(destination, remainder))
    const inApp = target.replace(/^\.\//, '').replace(/^\/app\//, '').replace(/^\//, '')
    if (inApp === patch) return true
  }
  return false
}

function fail(message) {
  console.error(`check-dockerfile-patches: ${message}`)
  process.exitCode = 1
}

const patches = readPatchedDependencies(readFileSync(WORKSPACE, 'utf8'))
if (patches.length === 0) {
  console.log('check-dockerfile-patches: no patchedDependencies declared, nothing to check')
  process.exit(0)
}

const instructions = readInstructions(readFileSync(DOCKERFILE, 'utf8'))
const installIndex = instructions.findIndex(isInstall)
if (installIndex === -1) {
  fail(`${DOCKERFILE} has no pnpm install instruction to check`)
} else {
  const beforeInstall = instructions.slice(0, installIndex)

  for (const { dependency, patch } of patches) {
    const absolute = join(ROOT, patch)
    if (!existsSync(absolute)) {
      fail(`${dependency} is patched with ${patch}, but that file does not exist`)
      continue
    }
    if (!beforeInstall.some((instruction) => copyCoversPatch(instruction, patch))) {
      fail(
        `${dependency} is patched with ${patch}, but ${DOCKERFILE} does not COPY it ` +
          'into the deps stage before pnpm install',
      )
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.log(`check-dockerfile-patches: ${patches.length} patch(es) present in the image context`)
