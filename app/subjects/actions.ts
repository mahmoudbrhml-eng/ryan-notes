'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function createSubject(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  if (!name || name.length > 120) return

  const supabase = await createClient()
  // user_id defaults to auth.uid() in the DB; RLS enforces ownership.
  const { error } = await supabase.from('subjects').insert({ name })
  if (error) throw new Error(error.message)
  revalidatePath('/subjects')
}

// Called directly from the client "new subject" button so it can hand back the
// id and the app can jump straight into the fresh subject (also from inside
// another subject — no need to go back to the home page first).
export async function addSubject(name: string): Promise<string | null> {
  const n = name.trim()
  if (!n || n.length > 120) return null

  const supabase = await createClient()
  const { data, error } = await supabase.from('subjects').insert({ name: n }).select('id').single()
  if (error) throw new Error(error.message)
  revalidatePath('/subjects')
  return data.id
}

export async function deleteSubject(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const supabase = await createClient()

  // Remove the stored files first, otherwise they would be orphaned in Storage.
  const { data: files } = await supabase
    .from('files')
    .select('storage_path')
    .eq('subject_id', id)
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length > 0) {
    await supabase.storage.from('lecture-files').remove(paths)
  }

  const { error } = await supabase.from('subjects').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/subjects')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
