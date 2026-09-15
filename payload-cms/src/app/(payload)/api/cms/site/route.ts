import { NextResponse } from 'next/server'
import { assembleSite } from '@/utilities/assembleSite'

export async function GET() {
  try {
    const site = await assembleSite()
    return NextResponse.json(site)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
