import { redirect } from 'next/navigation'

// Landing page comes later; for now go straight to the app (proxy sends guests to /login).
export default function Home() {
  redirect('/subjects')
}
