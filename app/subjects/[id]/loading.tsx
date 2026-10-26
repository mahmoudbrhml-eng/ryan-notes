export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="flex h-[76px] items-center gap-3 px-6">
        <div className="skeleton h-10 w-10" />
        <div className="skeleton h-5 w-48" />
      </div>
      <div className="ws">
        <div className="skeleton h-[420px] !rounded-3xl" />
        <div className="skeleton h-[420px] !rounded-3xl" />
        <div className="skeleton h-[420px] !rounded-3xl" />
      </div>
    </div>
  )
}
