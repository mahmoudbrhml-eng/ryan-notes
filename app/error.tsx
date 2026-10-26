'use client'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong · حصلت مشكلة</h1>
      <p className="muted">Please try again. · جرّب تاني.</p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>Try again · حاول تاني</button>
    </main>
  )
}
