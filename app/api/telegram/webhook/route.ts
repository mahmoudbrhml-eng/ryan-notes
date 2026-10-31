import { createClient } from '@/lib/supabase/server'
import { telegramEnabled, tgSend } from '@/lib/telegram'

// Telegram webhook: the ONLY unauthenticated door of the bot, and Telegram's
// servers are the only intended caller. Two layers protect it:
// 1) TELEGRAM_WEBHOOK_SECRET — Telegram echoes the secret set via setWebhook
//    in the x-telegram-bot-api-secret-token header on every update.
// 2) The bind itself goes through telegram_bind(), which accepts a valid
//    unexpired one-time token issued in-app — raw input can never attach a
//    chat to an account.
// Always answer 200 (unless forbidden): non-2xx makes Telegram retry-storm.

type StartMessage = {
  text?: string
  chat?: { id?: number | string; title?: string; type?: string }
  from?: { first_name?: string }
}

const MSG = {
  ok: 'تم الربط بنجاح ✅\nمن دلوقتي أي تفريغ أو ملخص أو اختبار يخلص، هتلاقي إشعار هنا على طول.',
  already: 'الشات ده مربوط بالفعل بحساب ✅ — لو عايز تغيّر الحساب، افصل الربط من الموقع الأول واربط من جديد.',
  bad: 'الرابط ده انتهى أو اتستخدم قبل كده.\nافتح الموقع ← قائمة حسابك ← «تليجرام» ← «اربط الآن»، وهات رابط جديد.',
  greet:
    'أهلاً بيك في Ryan Notes 👋\nاربط حسابك الأول: افتح الموقع ← قائمة حسابك (صورتك فوق) ← «تليجرام» ← «اربط الآن»، وبعدين ارجع هنا واضغط START.',
  else: 'أنا ببعتلك إشعار بس لما شغلك يخلص 📚\nللربط: الموقع ← قائمة حسابك ← «تليجرام».',
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const upd = (await req.json().catch(() => null)) as { message?: StartMessage } | null
    const msg = upd?.message
    const chatId = msg?.chat?.id
    const text = msg?.text ?? ''
    if (!chatId || !text || !telegramEnabled()) return Response.json({ ok: true })

    // Private chats only: notifications are personal, and binding a group to
    // an account would leak study content to everyone in it.
    if (msg?.chat?.type && msg.chat.type !== 'private') return Response.json({ ok: true })

    const start = text.match(/^\/start(?:\s+(\S+))?/)
    let reply: string
    if (start) {
      const payload = start[1] ?? ''
      if (payload) {
        const supabase = await createClient()
        const { data } = await supabase.rpc('telegram_bind', {
          p_token: payload,
          p_chat_id: String(chatId),
          p_title: msg.from?.first_name ?? msg.chat?.title ?? '',
        })
        const r = typeof data === 'string' ? data : null
        reply = r === 'ok' ? MSG.ok : r === 'already' ? MSG.already : MSG.bad
      } else {
        reply = MSG.greet
      }
    } else {
      reply = MSG.else
    }
    await tgSend(String(chatId), reply)
  } catch (e) {
    console.error('[telegram] webhook', e instanceof Error ? e.message : e)
  }
  return Response.json({ ok: true })
}
