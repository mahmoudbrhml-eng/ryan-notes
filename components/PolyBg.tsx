export default function PolyBg() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
    >
      <polygon points="0,0 40,0 25,30" fill="#10306A" opacity=".35" />
      <polygon points="40,0 100,0 70,25" fill="#0D2A5E" opacity=".4" />
      <polygon points="0,30 25,30 0,60" fill="#12397F" opacity=".25" />
      <polygon points="25,30 70,25 55,60" fill="#0A2552" opacity=".5" />
      <polygon points="70,25 100,0 100,45" fill="#123A86" opacity=".3" />
      <polygon points="55,60 100,45 100,60" fill="#0F3170" opacity=".35" />
      <polygon points="0,60 25,30 55,60" fill="#0C2B5E" opacity=".3" />
    </svg>
  )
}
