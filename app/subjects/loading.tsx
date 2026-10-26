export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="flex h-[76px] items-center gap-3 px-6">
        <div className="skeleton h-10 w-10" />
        <div className="skeleton h-5 w-32" />
      </div>
      <div className="mx-auto max-w-6xl px-6">
        <div className="skeleton mb-3 h-8 w-56" />
        <div className="skeleton mb-8 h-4 w-80 max-w-full" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-[190px] !rounded-[28px]" />
          ))}
        </div>
      </div>
    </div>
  )
}
