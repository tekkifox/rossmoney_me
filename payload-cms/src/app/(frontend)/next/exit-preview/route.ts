import { cookies, draftMode } from 'next/headers'

import { PREVIEW_MODE_COOKIE } from '@/utilities/publicPageCache'

export async function GET(): Promise<Response> {
  const draft = await draftMode()
  draft.disable()

  const cookieStore = await cookies()
  cookieStore.delete(PREVIEW_MODE_COOKIE)

  return new Response('Draft mode is disabled')
}
