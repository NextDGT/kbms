// Build the tests into one file and run them inside Electron, headless.
// better-sqlite3 is built for Electron, so plain Node cannot load the main process code.
//
//   npm test              all tests
//   npm test -- skip      only tests whose name or file contains "skip"
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = join(root, 'tests')
// Under out/ so the dictionaries resolve the way they do for the built app (../../resources)
const outfile = join(root, 'out', 'tests', 'run.cjs')

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

await build({
  stdin: {
    contents: [...files.map((name) => `import './${name}'`), `import './main'`].join('\n'),
    resolveDir: testsDir,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  external: ['electron', ...Object.keys(pkg.dependencies ?? {})],
  alias: { '@shared': join(root, 'src', 'shared') },
  // pdf.ts resolves pdf.js files through import.meta.url
  define: { 'import.meta.url': '__metaUrl' },
  banner: { js: "const __metaUrl = require('url').pathToFileURL(__filename).href;" },
  logLevel: 'warning'
})

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
// A terminal inside VS Code or Cursor sets this, which turns Electron into plain Node
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_ENABLE_LOGGING

const result = spawnSync(
  electron,
  ['--ozone-platform=headless', '--disable-gpu', outfile, ...process.argv.slice(2).map((a) => `--grep=${a}`)],
  { cwd: root, env, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' }
)

// Chromium logs about D-Bus and GPU drivers are noise here
const noise = /^\[\d+:\d+\/\d+\.\d+:(ERROR|WARNING|INFO)|^ERR: |MESA-LOADER|failed to load (swrast )?driver/
process.stderr.write(
  (result.stderr ?? '')
    .split('\n')
    .filter((line) => line && !noise.test(line))
    .map((line) => `${line}\n`)
    .join('')
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
