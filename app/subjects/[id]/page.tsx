import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: subject } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('id', id)
    .single()

  // RLS returns nothing for someone else's subject -> 404.
  if (!subject) notFound()

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/subjects" className="text-sm text-slate-400 hover:text-teal-400">
        ← موادي
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-teal-400">{subject.name}</h1>
      <p className="mt-6 text-slate-400">رفع الملفات هيتضاف هنا في الخطوة 3.</p>
    </main>
  )
}
