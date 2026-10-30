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
    .select('storage_path, parts')
    .eq('id', id)
    .single()
  if (!file) return

  // A hidden multi-part source keeps its extra objects in `parts` — they must
  // go with it, or storage fills up with orphaned lecture chunks.
  const paths = [file.storage_path]
  for (const p of (file.parts as { path?: string }[] | null) ?? []) {
    if (p?.path && !paths.includes(p.path)) paths.push(p.path)
  }
  await supabase.storage.from('lecture-files').remove(paths)
  const { error } = await supabase.from('files').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/subjects/${subjectId}`)
}
