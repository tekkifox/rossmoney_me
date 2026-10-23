import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  // Avoid Next.js build-time inlining so container runtime environment is honored.
  const siteKey = process.env['NEXT_PUBLIC_RECAPTCHA_SITE_KEY']
  if (!siteKey) {
    return NextResponse.json(
      { error: 'reCAPTCHA is not configured.' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    )
  }

  return NextResponse.json({ siteKey }, { headers: { 'Cache-Control': 'no-store' } })
}
