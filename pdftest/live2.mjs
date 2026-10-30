// LIVE e2e: create test user via real /auth/v1/signup, attach data via Management API,
// then call production /api/pdf-build and verify the PDF has a real Arabic text layer.
import { createServerClient } from '@supabase/ssr'
import { readFileSync, writeFileSync } from 'node:fs'

const URL_ = 'https://hieqmpdvpfrxmcelphlw.supabase.co'
const ANON = 'sb_publishable_NnMDzvoc6pyQ5a5hyQ6qTw_LCL0NIrW'
const LIVE = 'https://ryan-notes-zeta.vercel.app'
const EMAIL = 'pdf-e2e-test3@ryan-notes.app'
const PASS = 'RnE2E-T3st-2026!'

// Supabase Management token (for SQL data attach)
const SB = readFileSync('/home/z/my-project/scripts/.env-tokens', 'utf8')
  .split('\n').find((l) => l.startsWith('export SB='))?.split('=')[1]?.replace(/["']/g, '')

const captured = []
const supabase = createServerClient(URL_, ANON, {
  cookies: {
    getAll: () => [],
    setAll: (cs) => { captured.push(...cs) },
  },
})

// 1) sign in if the user exists, otherwise sign up (autoconfirm -> immediate session)
let session = null
{
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASS })
  if (!error && data?.session) session = data.session
  if (!session) {
    const { data, error } = await supabase.auth.signUp({ email: EMAIL, password: PASS })
    if (error || !data?.session) {
      console.error('sign-up failed:', error?.message ?? 'no session (autoconfirm off?)')
      process.exit(1)
    }
    session = data.session
  }
}
console.log('auth ok as', session.user.email, '| uid:', session.user.id)

// 2) attach e2e data (subject/file/output) to this user via Management API SQL
const sql = `
with s as (
  insert into public.subjects (user_id, name)
  select '${session.user.id}', 'PDF E2E Subject'
  where not exists (select 1 from public.subjects where user_id = '${session.user.id}')
  returning id, user_id
), su as (select id, user_id from s union all select id, user_id from public.subjects where user_id = '${session.user.id}' limit 1),
f as (
  insert into public.files (user_id, subject_id, name, storage_path, mime, size_bytes, ai_status)
  select su.user_id, su.id, 'e2e-lecture.txt', 'e2e/e2e-lecture.txt', 'text/plain', 12345, 'done' from su
  where not exists (select 1 from public.files where user_id = '${session.user.id}' and name = 'e2e-lecture.txt')
  returning id, user_id, subject_id
), fu as (select id, user_id, subject_id from f union all select id, user_id, subject_id from public.files where user_id = '${session.user.id}' and name = 'e2e-lecture.txt' limit 1)
insert into public.outputs (user_id, subject_id, file_id, kind, title, content, lang)
select fu.user_id, fu.subject_id, fu.id, 'transcript', 'Lecture E2E',
$md$## أمراض البروستاتا Prostate Diseases

البروستاتا هي غدة صغيرة توجد تحت المثانة **Bladder** عند الرجال فقط، وتحيط بالإحليل Urethra. يحدث تضخم البروستاتا الحميد BPH في معظم الرجال بعد سن الخمسين، ومن أعراضه التبول المتكرر ليلاً Nocturia وضعف تدفق البول Weak stream.

### سرطان البروستاتا Prostate Cancer

سرطان البروستاتا هو من أكثر أنواع السرطان شيوعًا عند الرجال، ويرتبط بمستوى PSA في الدم. الهرمونات الذكرية Androgens تحفز نمو الخلايا السرطانية، لذلك يُستخدم مثبطات 5-alpha reductase في بعض الحالات العلاجية.

| الدرجة Grade | وصف Description | العلاج Treatment |
| --- | --- | --- |
| منخفضة Low | مراقبة نشطة Active surveillance | متابعة دورية |
| متوسطة Intermediate | إشعاع أو جراحة | Radiation / Surgery |
| عالية High | علاج هرموني ADT | Hormone therapy |

> ملاحظة مهمة: فحص المستقيم الرقمي DRE جزء أساسي من الفحص السريري لكل مريض يشتبه في إصابته بأمراض البروستاتا.

المضادات الحيوية Antibiotics مثل Ciprofloxacin تُستخدم في التهابات البروستاتا البكتيرية Prostatitis، مع جرعة ممتدة لمدة أربعة أسابيع على الأقل حسب الحالة السريرية والحساسية الميكروبية. وفقًا لإرشادات EAU يُنصح بإجراء فحص PSA الدوري للرجال فوق الخمسين مع تقييم مخاطر الإصابة، ويظل التشخيص النهائي يعتمد على خزعة البروستاتا Prostate Biopsy.$md$
, 'ar'
from fu
where not exists (select 1 from public.outputs where user_id = '${session.user.id}' and kind = 'transcript')
returning id::text as output_id;`
const mgmt = await fetch('https://api.supabase.com/v1/projects/hieqmpdvpfrxmcelphlw/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
if (!mgmt.ok) { console.error('data attach failed:', (await mgmt.text()).slice(0, 300)); process.exit(1) }
console.log('data attached:', JSON.stringify(await mgmt.json()))

// 3) call the production PDF route with the app's cookie format
const cookieHeader = captured.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ')
const t0 = Date.now()
const res = await fetch(`${LIVE}/api/pdf-build`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieHeader },
  body: JSON.stringify({ subjectId: 'x', kind: 'transcript', fileId: (await (await fetch(`${URL_}/rest/v1/files?user_id=eq.${session.user.id}&select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` } })).json())[0].id }),
})
console.log('pdf-build status:', res.status, '| type:', res.headers.get('content-type'), '| in', Date.now() - t0, 'ms')
if (!res.ok) { console.error('body:', (await res.text()).slice(0, 400)); process.exit(1) }
const buf = Buffer.from(await res.arrayBuffer())
writeFileSync('/tmp/e2e-live.pdf', buf)
console.log('pdf bytes:', buf.length, '| header:', buf.subarray(0, 8).toString('latin1'))
