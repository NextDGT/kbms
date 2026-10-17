// Electron entry for the test run. Test files are imported before this one (see run.mjs).
import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAll } from './harness'

const workDir = mkdtempSync(join(tmpdir(), 'kbms-test-'))
app.setPath('userData', join(workDir, 'userData'))

const grep = process.argv.filter((a) => a.startsWith('--grep=')).map((a) => a.slice('--grep='.length))

app.whenReady().then(async () => {
  let failed = 1
  try {
    failed = await runAll(grep)
  } catch (err) {
    console.error(err)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
  app.exit(failed > 0 ? 1 : 0)
})
