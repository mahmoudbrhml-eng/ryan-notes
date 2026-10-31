import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import Icon from '@/components/Icon'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { getPlanStatus, PLANS, PLAN_ORDER, planChip, fmtMB, fmtTokens, fmtHours } from '@/lib/plans'

// "My plan" — current status + the Free/Plus/Pro/Max comparison. The limits
// themselves live in one place (sql/10_plans.sql) and are enforced there, so
// the bot and this page can never disagree.
export default async function PlanPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')

  const { lang, t } = await getI18n()
  const status = await getPlanStatus(supabase)
  const plan = status?.plan ?? 'free'
  const tokensLimit = status?.tokensLimit ?? null
  const tokensUsed = status?.tokensUsed ?? 0
  const audioUsed = status?.audioSecondsUsed ?? 0
  const audioLimit = status?.audioSecondsLimit ?? null // null = unlimited

  const pct = (used: number, limit: number | null) =>
    limit == null || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  const un = (n: number) => (!Number.isFinite(n) ? t.plan.unlimited : String(n))
  const expiry = status?.planExpiresAt
    ? new Date(status.planExpiresAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  const bar = (p: number) => (
    <div className="bar mt-1.5">
      <i style={{ width: `${Math.max(p, 2)}%` }} />
    </div>
  )

  return (
    <AppShell title={t.plan.title} back={{ href: '/subjects', label: t.ws.back }}>
      <main className="mx-auto w-full max-w-3xl px-4 pb-14 pt-5 md:px-6">
        <h1 className="mb-4 text-2xl font-bold">{t.plan.title}</h1>

        {/* current plan */}
        <section className="panel mb-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold muted">{t.plan.current}</span>
            <span className={`chip border-0 ${planChip[plan]}`} dir="ltr">{t.plan[plan]}</span>
            {expiry && plan !== 'free' && (
              <span className="text-xs muted">
                {t.plan.validUntil} <span dir="ltr">{expiry}</span>
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between text-sm font-semibold">
                <span>{t.plan.hoursThisMonth}</span>
                <span dir="ltr" className="muted">
                  {fmtHours(audioUsed)}{audioLimit == null ? '' : ` / ${fmtHours(audioLimit)}`}
                </span>
              </div>
              {bar(pct(audioUsed, audioLimit))}
            </div>
            <div>
              <div className="flex items-baseline justify-between text-sm font-semibold">
                <span>{t.plan.tokensToday}</span>
                <span dir="ltr" className="muted">
                  {tokensUsed.toLocaleString('en-US')}{tokensLimit == null ? '' : ` / ${tokensLimit.toLocaleString('en-US')}`}
                </span>
              </div>
              {bar(pct(tokensUsed, tokensLimit))}
            </div>
          </div>
          <p className="mt-3 text-xs muted">{t.plan.resetNote}</p>
        </section>

        {/* comparison */}
        <section className="panel mb-4 overflow-x-auto p-5">
          <h2 className="mb-3 text-lg font-bold">{t.plan.compare}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th className="py-2 text-start font-medium muted" />
                {PLAN_ORDER.map((p) => (
                  <th key={p} className="px-2 py-2 text-center">
                    <span className={`chip border-0 ${planChip[p]}`} dir="ltr">{t.plan[p]}</span>
                    {p === plan && <div className="mt-1 text-[10px] font-semibold muted">{t.plan.you}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/5">
                <td className="py-2.5 font-medium">{t.plan.hoursRow}</td>
                {PLAN_ORDER.map((p) => (
                  <td key={p} dir="ltr" className={`px-2 py-2.5 text-center font-semibold ${p === plan ? 'bg-brand-soft/40 rounded' : ''}`}>
                    {un(PLANS[p].hoursPerMonth)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-black/5 dark:border-white/5">
                <td className="py-2.5 font-medium">{t.plan.tokensRow}</td>
                {PLAN_ORDER.map((p) => (
                  <td key={p} dir="ltr" className={`px-2 py-2.5 text-center font-semibold ${p === plan ? 'bg-brand-soft/40 rounded' : ''}`}>
                    {Number.isFinite(PLANS[p].tokensPerDay) ? fmtTokens(PLANS[p].tokensPerDay) : t.plan.unlimited}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 font-medium">{t.plan.uploadRow}</td>
                {PLAN_ORDER.map((p) => (
                  <td key={p} dir="ltr" className={`px-2 py-2.5 text-center font-semibold ${p === plan ? 'bg-brand-soft/40 rounded' : ''}`}>
                    {fmtMB(PLANS[p].uploadMB)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>

        {/* upgrade CTA */}
        <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Icon name="send" className="h-5 w-5 shrink-0 text-brand" />
            <p className="min-w-0 flex-1 text-sm leading-6">{t.plan.upgradeVia}</p>
            <a
              href="https://t.me/rayan236_bot"
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm shrink-0"
            >
              {t.plan.openBot}
            </a>
          </div>
        </section>
      </main>
    </AppShell>
  )
}
