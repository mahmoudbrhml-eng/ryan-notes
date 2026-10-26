'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton({
  children,
  className = 'btn btn-primary',
}: {
  children: React.ReactNode
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={className}>
      {pending && <span className="spinner" />}
      {children}
    </button>
  )
}
