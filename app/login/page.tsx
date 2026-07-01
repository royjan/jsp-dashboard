'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Lock, Mail, Loader2, LogIn } from 'lucide-react'

function LoginForm() {
  const params = useSearchParams()
  const returnUrl = params.get('returnUrl') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d?.error || 'התחברות נכשלה')
        return
      }
      // Full reload so middleware re-evaluates with the new cookie.
      window.location.assign(returnUrl.startsWith('/') ? returnUrl : '/')
    } catch {
      setError('שגיאת רשת, נסה שוב')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">ג&apos;אן חלקים — ניתוח נתונים</h1>
          <p className="mt-1 text-sm text-muted-foreground">התחבר כדי להמשיך</p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">אימייל</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                dir="ltr"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@jan.co.il"
                className="h-11 w-full rounded-lg border border-border bg-background pe-9 ps-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">סיסמה</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-lg border border-border bg-background pe-9 ps-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                required
              />
            </div>
          </label>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs font-medium text-destructive"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            התחבר
          </button>
        </form>
      </motion.div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
