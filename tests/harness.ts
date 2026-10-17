import { register } from '../src/main/auth'

type TestFn = () => Promise<void> | void

interface TestCase {
  name: string
  file: string
  fn: TestFn
  skip?: string
}

const cases: TestCase[] = []
let currentFile = ''

/** Name the file the following tests belong to; shown in the report and matched by --grep. */
export function suite(file: string): void {
  currentFile = file
}

export function test(name: string, fn: TestFn): void {
  cases.push({ name, file: currentFile, fn })
}

/** A test that cannot run here, with the reason. */
export function skipTest(name: string, reason: string): void {
  cases.push({ name, file: currentFile, fn: () => {}, skip: reason })
}

/**
 * Run the tests one after another. Each starts signed in as its own new user, so lasting
 * ignored phrases and dictionary additions do not leak between tests. Returns failures.
 */
export async function runAll(grep: string[]): Promise<number> {
  const selected = cases.filter(
    (c) => grep.length === 0 || grep.some((g) => `${c.file} ${c.name}`.toLowerCase().includes(g.toLowerCase()))
  )
  let failed = 0
  let skipped = 0
  let lastFile = ''
  for (const [i, c] of selected.entries()) {
    if (c.file !== lastFile) {
      console.log(`\n${c.file}`)
      lastFile = c.file
    }
    if (c.skip) {
      skipped += 1
      console.log(`  - ${c.name} (atlandı: ${c.skip})`)
      continue
    }
    const started = Date.now()
    try {
      register(`test${i}`, 'secret123')
      await c.fn()
      console.log(`  ✓ ${c.name} (${Date.now() - started} ms)`)
    } catch (err) {
      failed += 1
      console.log(`  ✗ ${c.name}`)
      console.log(indent(err instanceof Error ? (err.stack ?? err.message) : String(err)))
    }
  }
  const passed = selected.length - failed - skipped
  console.log(`\n${passed} geçti, ${failed} başarısız, ${skipped} atlandı`)
  return failed
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
}
