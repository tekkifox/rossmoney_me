'use client'
import type { Form as FormType } from '@payloadcms/plugin-form-builder/types'
import type { Form as PayloadForm } from '@/payload-types'

import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, FormProvider, type FieldValues } from 'react-hook-form'
import RichText from '@/components/RichText'
import { Button } from '@/components/ui/button'
import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical'

import { fields } from './fields'
import { getClientSideURL } from '@/utilities/getURL'
import { getRecaptchaToken } from '@/utilities/getRecaptchaToken'

const honeypotFieldName = 'website'

export type FormBlockType = {
  blockName?: string
  blockType?: 'formBlock'
  enableIntro: boolean
  form: FormType | PayloadForm
  introContent?: DefaultTypedEditorState
}

export const FormBlock: React.FC<
  {
    id?: string
  } & FormBlockType
> = (props) => {
  const {
    enableIntro,
    form: formFromProps,
    form: { id: formID, confirmationMessage, confirmationType, redirect, submitButtonLabel } = {},
    introContent,
  } = props

  const formMethods = useForm<FieldValues>({
    defaultValues: formFromProps.fields ?? undefined,
  })
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
  } = formMethods

  const [isLoading, setIsLoading] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState<boolean>()
  const [error, setError] = useState<{ message: string; status?: string } | undefined>()
  const confirmationRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const errorMessage = error ? `${error.status ? `${error.status}: ` : ''}${error.message || ''}` : ''
  const statusMessage =
    isLoading && !hasSubmitted
      ? 'Sending your message, please wait.'
      : hasSubmitted && confirmationType === 'message'
        ? 'Your message was sent successfully.'
        : ''

  // The submit button unmounts when the confirmation replaces the form, so move
  // focus to the confirmation instead of letting it fall back to <body>.
  useEffect(() => {
    if (hasSubmitted && confirmationType === 'message') {
      confirmationRef.current?.focus()
    }
  }, [hasSubmitted, confirmationType])

  const onSubmit = useCallback(
    (data: FieldValues) => {
      const submitForm = async () => {
        let loadingTimerID: ReturnType<typeof setTimeout> | undefined
        setError(undefined)

        try {
          const recaptchaToken = await getRecaptchaToken()
          const dataToSend = [
            ...Object.entries(data).map(([name, value]) => ({ field: name, value })),
            { field: 'recaptcha-token', value: recaptchaToken },
          ]

          // delay loading indicator by 1s
          loadingTimerID = setTimeout(() => {
            setIsLoading(true)
          }, 1000)

          const req = await fetch(`${getClientSideURL()}/api/form-submissions`, {
            body: JSON.stringify({
              form: formID,
              submissionData: dataToSend,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'POST',
          })

          const res = await req.json()

          clearTimeout(loadingTimerID)

          if (req.status >= 400) {
            setIsLoading(false)

            setError({
              message: res.errors?.[0]?.message || 'Internal Server Error',
              status: res.status,
            })

            return
          }

          setIsLoading(false)
          setHasSubmitted(true)

          if (confirmationType === 'redirect' && redirect) {
            const { url } = redirect

            const redirectUrl = url

            if (redirectUrl) router.push(redirectUrl)
          }
        } catch (err) {
          console.warn(err)
          if (loadingTimerID) clearTimeout(loadingTimerID)
          setIsLoading(false)
          setError({
            message: err instanceof Error ? err.message : 'Something went wrong.',
          })
        }
      }

      void submitForm()
    },
    [router, formID, redirect, confirmationType],
  )

  return (
    <div className="container lg:max-w-[48rem]">
      {enableIntro && introContent && !hasSubmitted && (
        <RichText className="mb-8 lg:mb-12" data={introContent} enableGutter={false} />
      )}
      <div className="p-4 lg:p-6 border border-border rounded-[0.8rem]">
        <FormProvider {...formMethods}>
          {/* One live region per message: polite progress/success, assertive error. */}
          <output aria-atomic="true" aria-live="polite" className="sr-only">
            {statusMessage}
          </output>
          <div aria-atomic="true" className="sr-only" role="alert">
            {errorMessage}
          </div>
          {!isLoading && hasSubmitted && confirmationType === 'message' && (
            <div className="focus:outline-none" ref={confirmationRef} tabIndex={-1}>
              <RichText data={confirmationMessage} />
            </div>
          )}
          {isLoading && !hasSubmitted && <p>Loading, please wait...</p>}
          {error && <div>{errorMessage}</div>}
          {!hasSubmitted && (
            <form aria-busy={isLoading} id={formID} onSubmit={handleSubmit(onSubmit)}>
              <div className="mb-4 last:mb-0">
                {formFromProps &&
                  formFromProps.fields &&
                  formFromProps.fields?.map((field, index) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const Field: React.FC<any> = fields?.[field.blockType as keyof typeof fields]
                    if (Field) {
                      return (
                        <div className="mb-6 last:mb-0" key={index}>
                          <Field
                            form={formFromProps}
                            {...field}
                            {...formMethods}
                            control={control}
                            errors={errors}
                            register={register}
                          />
                        </div>
                      )
                    }
                    return null
                  })}
              </div>

              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor={`${formID}-${honeypotFieldName}`}>Website</label>
                <input
                  {...register(honeypotFieldName as never)}
                  autoComplete="off"
                  id={`${formID}-${honeypotFieldName}`}
                  tabIndex={-1}
                  type="text"
                />
              </div>

              <Button form={formID} type="submit" variant="default">
                {submitButtonLabel}
              </Button>
            </form>
          )}
        </FormProvider>
      </div>
    </div>
  )
}
