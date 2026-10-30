// LIVE end-to-end test of /api/pdf-build on production:
// sign in via the anon key, build the @supabase/ssr auth cookie exactly as the
// app stores it, call the deployed route, and verify the returned PDF.
import { createServerClient } from '@supabase/ssr'

const URL_ = 'https://hieqmpdvpfrxmcelphlw.supabase.co'
const ANON = 'sb_publishable_NnMDzvoc6pyQ5a5hyQ6qTw_LCL0NIrW'
const LIVE = 'https://ryan-notes-zeta.vercel.app'
const EMAIL = 'pdf-e2e-test2@ryan-notes.app'
const PASS = 'RnE2E-T3st-2026!'

const captured = []
const supabase = createServerClient(URL_, ANON, {
  cookies: {
    getAll: () => [],
    setAll: (cs) => { captured.push(...cs) },
  },
})

const { data: sess, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASS })
if (error || !sess?.session?.access_token) {
  console.error('sign-in failed:', error?.message)
  process.exit(1)
}
console.log('signed in as', sess.session.user.email, '| cookies captured:', captured.map((c) => c.name).join(','))

const cookieHeader = captured.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ')

// find the e2e subject/file ids via the REST API with the user's token
const rest = async (path) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${sess.session.access_token}` } })
  return r.json()
}
const subj = await rest('subjects?name=eq.PDF%20E2E%20Subject&select=id')
const file = await rest('files?name=eq.e2e-lecture.txt&select=id')
if (!subj[0] || !file[0]) { console.error('test data missing'); process.exit(1) }
const subjectId = subj[0].id
const fileId = file[0].id
console.log('subject:', subjectId, '| file:', fileId)

const t0 = Date.now()
const res = await fetch(`${LIVE}/api/pdf-build`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieHeader },
  body: JSON.stringify({ subjectId, kind: 'transcript', fileId }),
})
console.log('status:', res.status, '| content-type:', res.headers.get('content-type'), '| in', Date.now() - t0, 'ms')
if (!res.ok) {
  console.error('body:', (await res.text()).slice(0, 400))
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
const { writeFileSync } = await import('node:fs')
writeFileSync('/tmp/e2e-live.pdf', buf)
console.log('pdf bytes:', buf.length)
