import React from 'react'
import Link from 'next/link'

export default function HostUsageNavLink() {
  return (
    <Link href="/admin/host-usage" style={{ display: 'block', padding: '8px 12px' }}>
      Host usage
    </Link>
  )
}