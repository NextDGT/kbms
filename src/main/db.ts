import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'kbms.sqlite')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  return db
}

/** Create the current schema. Older layouts are not read or converted. */
function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      key_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('original', 'encoded', 'returned', 'restored')),
      name TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('pdf', 'docx')),
      body TEXT,
      mapping TEXT,
      path TEXT NOT NULL,
      source_document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (role = 'original' AND body IS NULL AND mapping IS NULL AND source_document_id IS NULL)
        OR (role = 'encoded' AND body IS NOT NULL AND mapping IS NOT NULL AND source_document_id IS NOT NULL)
        OR (role IN ('returned', 'restored') AND body IS NOT NULL AND mapping IS NULL AND source_document_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS documents_folder_idx ON documents(folder_id);
    CREATE INDEX IF NOT EXISTS documents_source_idx ON documents(source_document_id);

    CREATE TABLE IF NOT EXISTS document_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      indent_pt REAL NOT NULL,
      font_size REAL NOT NULL,
      bold INTEGER NOT NULL CHECK (bold IN (0, 1)),
      align TEXT NOT NULL CHECK (align IN ('left', 'center')),
      space_after_pt REAL NOT NULL,
      page_break_before INTEGER NOT NULL CHECK (page_break_before IN (0, 1)),
      page INTEGER,
      y_pt REAL,
      page_width_pt REAL,
      page_height_pt REAL,
      runs_json TEXT,
      UNIQUE (document_id, seq),
      CHECK (
        (page IS NULL AND y_pt IS NULL AND page_width_pt IS NULL AND page_height_pt IS NULL
          AND runs_json IS NULL)
        OR (page IS NOT NULL AND y_pt IS NOT NULL AND page_width_pt IS NOT NULL
          AND page_height_pt IS NOT NULL AND runs_json IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS user_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('AD', 'SOYAD')),
      value_norm TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, kind, value_norm)
    );

    CREATE TABLE IF NOT EXISTS user_ignored_phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phrase TEXT NOT NULL,
      phrase_norm TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, phrase_norm)
    );

    CREATE TABLE IF NOT EXISTS user_name_exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('AD', 'SOYAD')),
      value_norm TEXT NOT NULL,
      UNIQUE (user_id, kind, value_norm)
    );
  `)
}

export function getFilesRoot(): string {
  const dir = join(app.getPath('userData'), 'files')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
