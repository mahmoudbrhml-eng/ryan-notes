import type { SupabaseClient } from '@supabase/supabase-js'

// Telegram Bot API client — pure fetch, zero dependencies (no axios needed).
//
// Golden rule: a Telegram problem must NEVER break the user's request.
// Every function swallows its own errors (server log only, per the site's
// error policy) and reports success as a boolean, so callers can safely run
// them inside after() and forget about them.

const BOT = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || null
export const telegramEnabled = () => !!BOT()

type TgResult = { ok?: boolean; result?: { username?: string } | boolean } | null

async function call(method: string, body: unknown, timeoutMs = 8000): Promise<TgResult> {
  const token = BOT()
  if (!token) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const json = (await res.json().catch(() => null)) as TgResult
    if (!res.ok || !json?.ok) {
      console.error(`[telegram] ${method} failed (HTTP ${res.status})`)
      return null
    }
    return json
  } catch (e) {
    console.error('[telegram]', method, e instanceof Error ? e.message : e)
    return null
  }
}

export const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function tgGetMe(): Promise<{ username?: string } | null> {
  const r = await call('getMe', {})
  return r?.ok && r.result && typeof r.result === 'object' ? r.result : null
}

export type TgButton = { text: string; url: string }

export async function tgSend(chatId: string, html: string, buttons?: TgButton[]): Promise<boolean> {
  const r = await call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons?.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
  })
  return !!r?.ok
}

// Send a text file (transcript / summary) straight into the chat.
// Telegram accepts up to 50MB via multipart; we cap far below that.
export async function tgSendDocument(
  chatId: string,
  text: string,
  filename: string,
  caption?: string,
  buttons?: TgButton[]
): Promise<boolean> {
  const token = BOT()
  if (!token) return false
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('document', new Blob([text], { type: 'text/plain; charset=utf-8' }), filename)
    if (caption) form.append('caption', caption)
    form.append('parse_mode', 'HTML')
    if (buttons?.length) form.append('reply_markup', JSON.stringify({ inline_keyboard: [buttons] }))
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    })
    const json = (await res.json().catch(() => null)) as TgResult
    if (!res.ok || !json?.ok) {
      console.error(`[telegram] sendDocument failed (HTTP ${res.status})`)
      return false
    }
    return true
  } catch (e) {
    console.error('[telegram] sendDocument', e instanceof Error ? e.message : e)
    return false
  }
}

// ---------- notifications fired when AI work finishes ----------

type NotifyKind = 'transcript' | 'summary' | 'quiz'

const KIND_TEXT: Record<NotifyKind, { head: string; hint: string }> = {
  transcript: { head: 'خلص التفريغ ✅', hint: 'ملف التفريغ كامل جاهز تحت — وينفع تفتحه من الموقع برضه.' },
  summary: { head: 'الملخص جاهز ✅', hint: 'ملف الملخص جاهز تحت — والمراجعة الكاملة جوه الموقع.' },
  quiz: { head: 'الاختبار جاهز ✅', hint: 'افتحه من الزر وامتحان نفسك.' },
}

export function siteOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/+$/, '')
  return new URL(req.url).origin
}

export function outputUrl(
  origin: string,
  subjectId: string,
  fileId: string,
  tab: 'transcript' | 'summary' | 'quiz'
): string {
  return `${origin}/subjects/${subjectId}?f=${fileId}&tab=${tab}&p=notes`
}

// Windows-unfriendly characters out, reasonable length, always a .txt.
export function txtName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'ryan-notes'
  return `${base}.txt`
}

/**
 * Look up the user's bound chat (RLS: own row only) and send one message.
 * When `file` is provided the content travels as a .txt document with the
 * caption + button on it; otherwise it is a plain message. Call inside
 * after() — never throws, never blocks the response.
 */
export async function notifyReady(
  supabase: SupabaseClient,
  userId: string,
  kind: NotifyKind,
  opts: { title: string; url: string; file?: { text: string } }
): Promise<void> {
  try {
    if (!telegramEnabled() || !userId) return
    const { data, error } = await supabase
      .from('telegram_links')
      .select('chat_id')
      .eq('user_id', userId)
      .not('chat_id', 'is', null)
      .limit(1)
    if (error) {
      console.error('[telegram] chat lookup failed')
      return
    }
    const chatId = (data?.[0] as { chat_id?: string | null } | undefined)?.chat_id ?? null
    if (!chatId) return

    const meta = KIND_TEXT[kind]
    const title = escHtml(opts.title.slice(0, 200))
    const html = `<b>${meta.head}</b>\n📄 <b>${title}</b>\n${meta.hint}`
    const buttons: TgButton[] = [{ text: 'افتح في Ryan Notes', url: opts.url }]

    const body = opts.file?.text ?? ''
    if (body.length > 0 && body.length <= 1_500_000) {
      await tgSendDocument(chatId, body, txtName(opts.title), html, buttons)
    } else {
      await tgSend(chatId, html, buttons)
    }
  } catch (e) {
    console.error('[telegram] notify failed', e instanceof Error ? e.message : e)
  }
}
