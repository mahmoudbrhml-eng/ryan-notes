import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { telegramEnabled, tgGetMe } from '@/lib/telegram'

// Issue a one-time Telegram binding link: t.me/<bot>?start=<token>.
// The token lives 30 minutes, is stored on the caller's own row (RLS), and is
// consumed by telegram_bind() when the user presses START. The bot username
// is resolved server-side via getMe — the bot token never reaches the client.

export async function POST(req: Request) {
  if (!telegramEnabled()) {
    return NextResponse.json({ error: 'Telegram is not enabled yet.', configured: false }, { status: 503 })
  }
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 })

  const me = await tgGetMe()
  const username = me?.username
  if (!username) return NextResponse.json({ error: 'The bot is not reachable right now.' }, { status: 503 })

  const token = randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + 30 * 60e3).toISOString()
  const { error } = await supabase.from('telegram_links').upsert(
    { user_id: userId, link_token: token, token_expires_at: expires },
    { onConflict: 'user_id' }
  )
  if (error) return NextResponse.json({ error: 'Could not start the link. Try again.' }, { status: 500 })

  return NextResponse.json({ url: `https://t.me/${username}?start=${token}` })
}
