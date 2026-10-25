'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function deleteFile(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const subjectId = String(formData.get('subjectId') ?? '')
  if (!id) return

  const supabase = await createClient()
  // RLS only returns the row if it belongs to the signed-in user.
  const { data: file } = await supabase
    .from('files')
    .select('storage_path')
    .eq('id', id)
    .single()
  if (!file) return

  await supabase.storage.from('lecture-files').remove([file.storage_path])
  const { error } = await supabase.from('files').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/subjects/${subjectId}`)
}
