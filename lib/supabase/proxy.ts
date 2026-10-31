import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data } = await supabase.auth.getClaims()
  const loggedIn = !!data?.claims

  const path = request.nextUrl.pathname
  const isAuthPage = path.startsWith('/login')
  // /s/<token> is the public share page: no account needed to view it.
  // /api/telegram/webhook is called by Telegram's servers, which carry no
  // session cookie — redirecting them would silently kill the bot.
  const isPublic =
    path === '/' || isAuthPage || path.startsWith('/auth') || path.startsWith('/s/') ||
    path === '/api/telegram/webhook'

  if (!loggedIn && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (loggedIn && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/subjects'
    return NextResponse.redirect(url)
  }
  return supabaseResponse
}
