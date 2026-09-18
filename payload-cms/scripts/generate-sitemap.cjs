#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const seedDir = path.join(__dirname, '..', 'src', 'endpoints', 'seed')
const publicDir = path.join(__dirname, '..', 'public')

function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SERVER_URL || process.env.SERVER_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'https://www.rossmoney.me'
  ).replace(/\/$/, '')
}

function findSlugs() {
  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
  const slugs = new Set()
  for (const file of files) {
    const text = fs.readFileSync(path.join(seedDir, file), 'utf8')
    const m = text.match(/slug\s*:\s*['"`]([^'"`]+)['"`]/)
    if (m && m[1]) slugs.add(m[1].trim())
  }
  return Array.from(slugs)
}

function writeSitemap(urls) {
  const siteUrl = getSiteUrl()
  const xml = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`]
  for (const u of urls) {
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

function main() {
  const slugs = findSlugs()
  // map slugs to paths; treat 'home' as root
  const urls = new Set()
  urls.add('/')
  for (const s of slugs) {
    if (!s) continue
    if (s === 'home') continue
    urls.add('/' + s)
  }
  writeSitemap(Array.from(urls))
  writeRobots()
}

main()
