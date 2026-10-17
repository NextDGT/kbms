import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { BookUser, FolderClosed, LogOut, Menu, X } from 'lucide-react'
import type { UserPublic } from '@shared/types'

export type ShellSection = 'folders' | 'names'

interface Props {
  user: UserPublic
  section: ShellSection
  onNavigate: (section: ShellSection) => void
  onLogout: () => void
  children: ReactNode
}

const NAV: Array<{ id: ShellSection; label: string; icon: typeof FolderClosed }> = [
  { id: 'folders', label: 'Klasörler', icon: FolderClosed },
  { id: 'names', label: 'Ad / soyad', icon: BookUser }
]

export function AppShell({ user, section, onNavigate, onLogout, children }: Props) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (wasOpen.current && !open) menuButtonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  function go(next: ShellSection) {
    setOpen(false)
    onNavigate(next)
  }

  const sectionLabel = NAV.find((item) => item.id === section)?.label ?? ''

  return (
    <div className="min-h-screen bg-[#f3f5f6] text-ink-900">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-3 sm:px-4">
        <button
          ref={menuButtonRef}
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-800 hover:bg-ink-100"
          aria-label="Menü"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <div className="h-5 w-px bg-ink-200" />
        <p className="text-[13px] font-semibold tracking-[0.18em] text-ink-950">KBMS</p>
        <p className="ml-auto truncate text-sm text-ink-500">{sectionLabel}</p>
      </header>

      <div className={open ? 'fixed inset-0 z-40' : 'pointer-events-none fixed inset-0 z-40'}>
        <button
          type="button"
          className={`absolute inset-0 bg-ink-950/45 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
          aria-label="Menüyü kapat"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        />
        <aside
          id={menuId}
          inert={!open}
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ink-950 text-sand-50 shadow-2xl transition-transform duration-200 ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
          aria-hidden={!open}
        >
          <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
            <div>
              <p className="text-[13px] font-semibold tracking-[0.18em]">KBMS</p>
              <p className="mt-0.5 text-[11px] text-white/50">Kurumsal Belge Maskeleme Sistemi</p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Kapat"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <nav className="flex flex-col gap-1 p-3" aria-label="Ana menü">
            {NAV.map((item, index) => {
              const Icon = item.icon
              const active = item.id === section
              return (
                <button
                  key={item.id}
                  ref={index === 0 ? firstItemRef : undefined}
                  type="button"
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${
                    active ? 'bg-white/10 font-medium text-white' : 'text-white/75 hover:bg-white/5 hover:text-white'
                  }`}
                  onClick={() => go(item.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto border-t border-white/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">Oturum</p>
            <p className="mt-1 truncate text-sm font-medium">{user.username}</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/75 hover:bg-white/10 hover:text-white"
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
              Çıkış
            </button>
          </div>
        </aside>
      </div>

      <div>{children}</div>
    </div>
  )
}
