import { NextResponse } from 'next/server'

import { isTurnstileRequired } from '@/utilities/verifyTurnstile'

export const dynamic = 'force-dynamic'

export function GET() {
  // Read at request time so the container/runtime environment is honoured.
  // The secret never leaves the server; only the public site key and whether a
  // challenge is mandatory are exposed, so development and preview can render
  // the form without keys.
  const siteKey = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY']

  return NextResponse.json(
    {
      required: isTurnstileRequired(),
      siteKey: siteKey || null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
