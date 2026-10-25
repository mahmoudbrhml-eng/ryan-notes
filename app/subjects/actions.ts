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
