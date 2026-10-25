import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ConfirmButton from '@/components/ConfirmButton'
import { createSubject, deleteSubject, signOut } from './actions'

export default async function SubjectsPage() {
  const supabase = await createClient()
  const { data: subjects, error } = await supabase
    .from('subjects')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-teal-400">موادي</h1>
        <form action={signOut}>
          <button className="text-sm text-slate-400 hover:text-white">تسجيل خروج</button>
        </form>
      </header>

      <form action={createSubject} className="mb-8 flex gap-2">
        <input
          name="name"
          required
          maxLength={120}
          placeholder="اسم مادة جديدة (مثلاً Cardiology)"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-teal-500"
        />
        <button className="rounded-lg bg-teal-600 px-5 font-semibold hover:bg-teal-500">
          إضافة
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-400">حصل خطأ: {error.message}</p>}

      {subjects?.length === 0 && (
        <p className="text-slate-400">لسه معندكش مواد. ضيف أول مادة من فوق.</p>
      )}

      <ul className="space-y-3">
        {subjects?.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4"
          >
            <Link href={`/subjects/${s.id}`} className="flex-1 font-medium hover:text-teal-400">
              {s.name}
            </Link>
            <form action={deleteSubject}>
              <input type="hidden" name="id" value={s.id} />
              <ConfirmButton
                message={`مسح "${s.name}" وكل ما فيها؟`}
                className="text-sm text-slate-500 hover:text-red-400"
              >
                مسح
              </ConfirmButton>
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
