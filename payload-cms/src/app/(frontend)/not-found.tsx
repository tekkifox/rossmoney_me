import Link from 'next/link'
import React from 'react'

import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="container py-28">
        <div className="prose max-w-none">
          <h1 style={{ marginBottom: 0 }}>Page not found</h1>
          <p className="mb-4">The page you are looking for could not be found.</p>
        </div>
        <Button asChild variant="default">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  )
}
