import { useEffect, useState } from 'react'
import type { UserPublic } from '@shared/types'
import { AppShell } from './components/AppShell'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { FolderDetailPage } from './pages/FolderDetailPage'
import { FoldersPage } from './pages/FoldersPage'
import { LoginPage } from './pages/LoginPage'
import { NamesPage } from './pages/NamesPage'

type Route =
  | { name: 'login' }
  | { name: 'folders' }
  | { name: 'names' }
  | { name: 'folder'; folderId: number }
  | { name: 'document'; folderId: number; documentId: number }

export function App() {
  const [user, setUser] = useState<UserPublic | null>(null)
  const [route, setRoute] = useState<Route>({ name: 'login' })
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    void window.kbms.auth
      .session()
      .then((session) => {
        if (session?.user) {
          setUser(session.user)
          setRoute({ name: 'folders' })
        }
      })
      .finally(() => setBooting(false))
  }, [])

  async function logout() {
    await window.kbms.auth.logout()
    setUser(null)
    setRoute({ name: 'login' })
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-500">Yükleniyor…</div>
    )
  }

  if (!user || route.name === 'login') {
    return (
      <LoginPage
        onAuthed={async () => {
          const session = await window.kbms.auth.session()
          if (session?.user) {
            setUser(session.user)
            setRoute({ name: 'folders' })
          }
        }}
      />
    )
  }

  return (
    <AppShell
      user={user}
      section={route.name === 'names' ? 'names' : 'folders'}
      onNavigate={(section) =>
        setRoute(section === 'names' ? { name: 'names' } : { name: 'folders' })
      }
      onLogout={() => void logout()}
    >
      {route.name === 'folder' ? (
        <FolderDetailPage
          folderId={route.folderId}
          onBack={() => setRoute({ name: 'folders' })}
          onOpenDocument={(documentId) =>
            setRoute({ name: 'document', folderId: route.folderId, documentId })
          }
        />
      ) : route.name === 'document' ? (
        <DocumentDetailPage
          documentId={route.documentId}
          onBack={() => setRoute({ name: 'folder', folderId: route.folderId })}
          onOpenDocument={(documentId) =>
            setRoute({ name: 'document', folderId: route.folderId, documentId })
          }
        />
      ) : route.name === 'names' ? (
        <NamesPage />
      ) : (
        <FoldersPage onOpen={(folderId) => setRoute({ name: 'folder', folderId })} />
      )}
    </AppShell>
  )
}
