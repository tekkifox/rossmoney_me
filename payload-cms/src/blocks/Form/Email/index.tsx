import type { EmailField } from '@payloadcms/plugin-form-builder/types'
import type { FieldErrorsImpl, FieldValues, UseFormRegister } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import React from 'react'

import { Error } from '../Error'
import { Width } from '../Width'

export const Email: React.FC<
  EmailField & {
    errors: Partial<FieldErrorsImpl>
    register: UseFormRegister<FieldValues>
  }
> = ({ name, defaultValue, errors, label, register, required, width }) => {
  return (
    <Width width={width}>
      <Label htmlFor={name}>
        {label}

        {required && (
          <span className="required">
            * <span className="sr-only">(required)</span>
          </span>
        )}
      </Label>
      <Input
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        aria-invalid={Boolean(errors[name])}
        defaultValue={defaultValue}
        id={name}
        type="email"
        {...register(name, {
          pattern: { message: 'Enter a valid email address.', value: /^\S[^\s@]*@\S+$/ },
          required: required ? 'Email is required.' : false,
        })}
      />

      {errors[name] && <Error name={name} />}
    </Width>
  )
}
