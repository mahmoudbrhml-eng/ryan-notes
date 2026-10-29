import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // /ffmpeg/ is the self-hosted compression engine: plain static files that
    // must be reachable without a session (the worker loads them directly).
    '/((?!_next/static|_next/image|favicon.ico|ffmpeg/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
