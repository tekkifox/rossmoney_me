import Image from 'next/image'
import React from 'react'

import { PageDoc, PageMeta, RenderLayout, Section } from './shared'

const LEGEND = [
  { label: 'Hub', detail: 'the management host, carrying the front door and control plane' },
  { label: 'Edge', detail: 'the public host that terminates TLS and proxies into the mesh' },
  { label: 'Media', detail: 'streaming services, kept off the public edge' },
  { label: 'Storage', detail: 'the library worker and scheduled backups' },
  { label: 'Photos', detail: 'the photo library and the public travel site' },
  { label: 'Build', detail: 'the agent runtime and the image builds' },
  { label: 'Games', detail: 'game hosting and the game panel' },
  { label: 'Mesh', detail: 'the private encrypted network the hosts talk over' },
  {
    label: 'Managed data',
    detail: 'three hosted stores: the content database, an analytics warehouse, and an object store for backups',
  },
]

const DIAGRAM_ALT =
  'Public architecture diagram: any client reaches the public edge over HTTPS, which proxies requests into a private encrypted mesh. The mesh connects seven hosts by role — hub, edge, media, storage, photos, build, and games — each running its own services. A managed data layer sits off-host with three hosted stores: a content database, an analytics warehouse, and an object store for backups.'

export default function MapTemplate({ page }: { page: PageDoc }) {
  return (
    <main id="main-content" tabIndex={-1} className="map-page">
      <PageMeta page={page} />

      <section className="hero container">
        <div className="hero-copy">
          {page.eyebrow && <p className="eyebrow">{page.eyebrow}</p>}
          {page.title && <h1>{page.title}</h1>}
          {page.lead && <p className="lead">{page.lead}</p>}
        </div>
      </section>

      <Section
        className="space-y-5! py-6! sm:py-8!"
        eyebrow="Public view"
        title="One edge, a private mesh, and the hosts behind it."
      >
        <figure className="m-0">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <Image
              alt={DIAGRAM_ALT}
              className="block h-auto w-full"
              height={2100}
              sizes="(max-width: 1140px) 100vw, 1116px"
              src="/infrastructure-map.png"
              width={3400}
            />
          </div>

          <figcaption className="mt-5">
            <h3 className="text-lg font-medium tracking-tight">Legend</h3>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm leading-6 sm:grid-cols-2">
              {LEGEND.map((item) => (
                <div key={item.label} className="flex gap-3">
                  <dt className="font-semibold">{item.label}</dt>
                  <dd className="text-muted-foreground">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </figcaption>
        </figure>
      </Section>

      <RenderLayout page={page} />
    </main>
  )
}
