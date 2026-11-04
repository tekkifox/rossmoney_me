import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ImageResponse } from 'next/og'

import { OG_THEME } from '@/utilities/ogTheme'
import {
  OG_IMAGE_CACHE_CONTROL,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  resolveOgContent,
  STATIC_OG_IMAGE_PATH,
  type OgContent,
} from '@/utilities/ogImage'

const FONT_DIRECTORY = path.join(process.cwd(), 'public', 'og-fonts')

type CardFont = {
  name: string
  data: ArrayBuffer
  weight: 400 | 700
  style: 'normal'
}

let fontsPromise: Promise<CardFont[]> | null = null

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

/**
 * Read the two weights once per process. Both live in `public/`, which is
 * present in `next dev`, `next start`, the standalone Docker tree and Vercel.
 */
function loadFonts(): Promise<CardFont[]> {
  fontsPromise ??= Promise.all([
    readFile(path.join(FONT_DIRECTORY, 'Geist-Regular.ttf')),
    readFile(path.join(FONT_DIRECTORY, 'Geist-Bold.ttf')),
  ]).then(([regular, bold]) => [
    {
      name: 'geist',
      data: toArrayBuffer(regular),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'geist',
      data: toArrayBuffer(bold),
      weight: 700,
      style: 'normal',
    },
  ])

  return fontsPromise
}

/** Keep the static card's type scale, but shrink before a long title can clip. */
function titleSize(title: string): number {
  const length = Array.from(title).length

  if (length <= 24) return 64
  if (length <= 48) return 56
  if (length <= 72) return 48
  return 40
}

function descriptionSize(description: string): number {
  const length = Array.from(description).length

  if (length <= 80) return 30
  if (length <= 140) return 28
  return 26
}

function Card({ title, description }: OgContent) {
  const colours = OG_THEME

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(225deg, ${colours.heroFrom} 0%, ${colours.heroMid} 55%, ${colours.heroTo} 100%)`,
        fontFamily: 'geist',
      }}
    >
      {/* The static card's faint engineering grid. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          opacity: 0.55,
          backgroundImage: `linear-gradient(to right, ${colours.gridStroke} 1px, transparent 1px), linear-gradient(to bottom, ${colours.gridStroke} 1px, transparent 1px)`,
          backgroundSize: '200px 200px',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 544,
          padding: '48px 16px 48px 48px',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 64,
            height: 64,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${colours.primary} 0%, ${colours.primarySoft} 100%)`,
            color: colours.card,
            fontFamily: 'Georgia, serif',
            fontSize: 27,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          RM
        </div>

        <div style={{ display: 'flex', marginTop: 36 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderRadius: 999,
              border: `2px solid ${colours.text}`,
              color: colours.text,
              fontSize: 22,
              lineHeight: 1.2,
            }}
          >
            rossmoney.me
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexGrow: 1,
            alignItems: 'flex-start',
            marginTop: 28,
            paddingBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: titleSize(title),
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              wordBreak: 'break-word',
              color: colours.text,
            }}
          >
            {title}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 560,
          flexGrow: 0,
          flexShrink: 0,
          margin: '48px 48px 48px 48px',
          padding: 32,
          borderRadius: 12,
          border: `1px solid ${colours.border}`,
          background: colours.card,
          boxShadow: `0 6px 18px ${colours.cardShadow}`,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.12em',
            lineHeight: 1.3,
            textTransform: 'uppercase',
            color: colours.primary,
          }}
        >
          Available for DevOps and developer roles
        </div>

        <div
          style={{
            display: 'flex',
            width: 60,
            height: 2,
            margin: '20px 0 24px',
            background: colours.primarySoft,
          }}
        />

        <div
          style={{
            display: 'flex',
            flexGrow: 0,
            maxHeight: 280,
            overflow: 'hidden',
            fontSize: descriptionSize(description),
            lineHeight: 1.4,
            wordBreak: 'break-word',
            color: colours.muted,
          }}
        >
          {description}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 16px',
              borderRadius: 8,
              background: colours.primary,
              color: colours.card,
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Start a conversation
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${colours.borderControl}`,
              background: colours.card,
              color: colours.text,
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Inspect live architecture
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 'auto',
            paddingTop: 16,
          }}
        >
          {[
            { value: '99.95%', label: 'availability target' },
            { value: '24/7', label: 'operations mindset' },
            { value: 'DX', label: 'developer experience' },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexGrow: 1,
                flexBasis: 0,
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 8px',
                minHeight: 72,
                borderRadius: 10,
                border: `1px solid ${colours.border}`,
                background: colours.card,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: colours.text,
                }}
              >
                {metric.value}
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 6,
                  fontSize: 14,
                  lineHeight: 1.2,
                  textAlign: 'center',
                  color: colours.muted,
                }}
              >
                {metric.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const content = resolveOgContent(searchParams)

  try {
    const fonts = await loadFonts()

    return new ImageResponse(<Card {...content} />, {
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      fonts,
      headers: {
        'Cache-Control': OG_IMAGE_CACHE_CONTROL,
        'Content-Disposition': 'inline; filename="og.png"',
      },
    })
  } catch (error) {
    // A renderer or font failure must not turn every page's preview into a
    // broken image. Serve the shipped static card and keep it out of the shared
    // cache long enough for a fixed deploy to take over.
    console.error('[og] failed to render the dynamic card:', error)

    const fallback = await readFile(
      path.join(process.cwd(), 'public', STATIC_OG_IMAGE_PATH.replace(/^\//, '')),
    )

    return new Response(new Uint8Array(fallback), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    })
  }
}
