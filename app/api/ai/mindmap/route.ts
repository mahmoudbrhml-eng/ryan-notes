import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { mindmapPrompt, type MindNode, type NotesLang } from '@/lib/prompts'
import { sampleText } from '@/lib/clean'
import { tracker } from '@/lib/usage'
import { guardQuota } from '@/lib/quota'

export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

// Validate/repair the AI tree: keep it depth ≤ 3, trim strings, drop noise.
// Never trusts model output shape; an unreadable tree fails the request.
function cleanNode(n: unknown, depth: number): MindNode | null {
  if (!n || typeof n !== 'object' || depth > 2) return null
  const o = n as Record<string, unknown>
  const t = String(o.t ?? o.title ?? o.text ?? '').trim().slice(0, 120)
  if (!t) return null
  const kids = Array.isArray(o.children) ? o.children : Array.isArray(o.c) ? o.c : []
  const c = kids.map((k) => cleanNode(k, depth + 1)).filter((k): k is MindNode => !!k).slice(0, 8)
  return c.length > 0 ? { t, c } : { t }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const fileId = String(body.fileId ?? '')
    if (!UUID.test(fileId)) return fail('Invalid file')
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'
    const custom = typeof body.custom === 'string' ? body.custom.trim().slice(0, 600) : ''

    const { data: tr } = await supabase
      .from('outputs')
      .select('subject_id, title, content')
      .eq('file_id', fileId)
      .eq('kind', 'transcript')
      .maybeSingle()
    if (!tr || !tr.content) return fail('Transcribe the file first.', 409, 'need_transcript')

    // Fail closed: if the usage check itself errors, no AI call goes out.
    const q = await guardQuota(supabase, 'mindmap')
    if (!q.ok) return fail(q.error, q.status, q.code)

    let raw: string
    try {
      raw = await generate([{ text: mindmapPrompt(lang, sampleText(tr.content, 120000), custom) }], {
        json: true, max: 8000, track: tracker(supabase, 'mindmap'),
      })
    } catch (e) {
      // A failed generation never costs the user a call.
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'mindmap' }) } catch {} })
      throw e
    }

    let tree: MindNode | null = null
    try {
      tree = cleanNode(JSON.parse(raw), 0)
    } catch { /* unreadable JSON → 502 below */ }
    if (!tree || !tree.c || tree.c.length === 0)
      return fail('The AI returned an unreadable mind map. Press Generate again.', 502)

    const { data: existing } = await supabase
      .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'mindmap').maybeSingle()
    const row = {
      subject_id: tr.subject_id, file_id: fileId, kind: 'mindmap', title: tr.title, lang: custom ? 'custom' : lang, content: '', data: tree,
    }
    const { error: upErr } = existing
      ? await supabase.from('outputs').update({ data: tree, lang: custom ? 'custom' : lang }).eq('id', existing.id)
      : await supabase.from('outputs').insert(row)
    if (upErr) {
      // Never swallow storage errors: the user paid a call for this tree.
      console.error('[mindmap] upsert', upErr.message)
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'mindmap' }) } catch {} })
      return fail('Could not save the mind map. Try again in a moment.', 503, 'save')
    }

    return NextResponse.json({ ok: true, nodes: tree.c.length })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[mindmap]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
