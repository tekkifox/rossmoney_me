import type { TextField } from '@payloadcms/plugin-form-builder/types'
import type { FieldErrorsImpl, FieldValues, UseFormRegister } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import React from 'react'

import { Error } from '../Error'
import { Width } from '../Width'
export const Number: React.FC<
  TextField & {
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
        type={name === 'phone' ? 'tel' : 'number'}
        {...register(name, {
          pattern:
            name === 'phone'
              ? { message: 'Enter a valid phone number.', value: /^\+?[0-9][0-9 ()-]{6,19}$/ }
              : undefined,
          required: required ? `${label} is required.` : false,
        })}
      />
      {errors[name] && <Error name={name} />}
    </Width>
  )
}
