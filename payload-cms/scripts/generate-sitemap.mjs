#!/usr/bin/env node
// Run this through `tsx` (see the `generate:sitemap` script in package.json):
// it imports the TypeScript resolver shared with the dynamic sitemap route.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isSitemapExcluded,
  resolveHeaderSitemapPaths,
} from '../src/utilities/sitemapPaths.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')

function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SERVER_URL || process.env.SERVER_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'https://www.rossmoney.me'
  ).replace(/\/$/, '')
}

function writeSitemap(urls) {
  const siteUrl = getSiteUrl()
  const xml = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`]
  for (const u of urls) {
    if (isSitemapExcluded(u)) continue
    xml.push('  <url>')
    xml.push(`    <loc>${siteUrl}${u}</loc>`)
    xml.push('    <changefreq>monthly</changefreq>')
    xml.push('  </url>')
  }
  xml.push('</urlset>')
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), xml.join('\n'))
  console.log('Wrote', path.join(publicDir, 'sitemap.xml'))
}

function writeRobots() {
  const siteUrl = getSiteUrl()
  const lines = []
  lines.push('User-agent: *')
  lines.push('Disallow: /admin/')
  lines.push('Disallow: /api/')
  lines.push('Disallow: /payload/')
  lines.push('Allow: /media/')
  lines.push('')
  lines.push(`# Sitemap generated - update as needed`)
  lines.push(`Sitemap: ${siteUrl}/sitemap.xml`)
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
  fs.writeFileSync(path.join(publicDir, 'robots.txt'), lines.join('\n'))
  console.log('Wrote', path.join(publicDir, 'robots.txt'))
}

async function main() {
  // No database is available during a static build, so the shared resolver
  // falls back to the navigation seeded in `payload.config.ts` and
  // `src/endpoints/seed/index.ts`.
  const urls = await resolveHeaderSitemapPaths()
  writeSitemap(urls)
  writeRobots()
}

await main()
