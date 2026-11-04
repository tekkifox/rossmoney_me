'use client'

import * as React from 'react'
import { useFormContext } from 'react-hook-form'

export const Error = ({ name }: { name: string }) => {
  const {
    formState: { errors },
  } = useFormContext()
  return (
    <div className="mt-2 text-error-text text-sm" id={`${name}-error`} role="alert">
      {(errors[name]?.message as string) || 'This field is required'}
    </div>
  )
}
