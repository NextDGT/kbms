import { FormEvent, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'

interface Props {
  onAuthed: () => void
}

export function LoginPage({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await window.kbms.auth.login(username, password)
      } else {
        await window.kbms.auth.register(username, password)
      }
      onAuthed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hata')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-veil-300/30 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-sand-200/80 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-veil-700">Çevrimdışı · KVKK</p>
          <div>
            <h1 className="font-display text-5xl leading-[1.05] text-ink-950 sm:text-6xl">KBMS</h1>
            <p className="mt-2 text-xl text-ink-700">Kurumsal Belge Maskeleme Sistemi</p>
          </div>
          <p className="max-w-md text-lg text-ink-600">
            PDF ve Word belgelerindeki kişisel verileri yerelde maskeleyin. Anahtarlar cihazınızda,
            her anonim belgenin kaydında şifreli kalır; üçüncü tarafa yalnızca örtülü metin çıkar.
          </p>
        </div>

        <Card className="w-full">
          <div className="mb-6 flex gap-2 rounded-xl bg-ink-100/70 p-1">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === 'login' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
              }`}
              onClick={() => setMode('login')}
            >
              Giriş
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === 'register' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
              }`}
              onClick={() => setMode('register')}
            >
              Hesap oluştur
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <Label htmlFor="username">Kullanıcı adı</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Parola</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <Button className="w-full" disabled={busy} type="submit">
              {busy ? 'Bekleyin…' : mode === 'login' ? 'Giriş yap' : 'Hesabı oluştur'}
            </Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Hesaplar ve anahtarlar yalnızca bu cihazdaki yerel veritabanında tutulur. İnternet
            bağlantısı gerekmez.
          </p>
        </Card>
      </div>
    </div>
  )
}
