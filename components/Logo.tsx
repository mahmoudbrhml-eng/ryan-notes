export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Ryan Notes" width={size} height={size} />
    </span>
  )
}
