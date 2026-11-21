import { test, expect } from 'bun:test'
import { shouldNotify, notifyArgs, plistFor, message, LABEL } from '../src/watch'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shouldNotify: first time yes, inside cooldown no, after cooldown yes', () => {
  const now = 1e12, h = 3_600_000
  expect(shouldNotify(undefined, now, 6)).toBe(true)
  expect(shouldNotify(now - 5 * h, now, 6)).toBe(false)
  expect(shouldNotify(now - 6 * h, now, 6)).toBe(true)
  expect(shouldNotify(now - 1, now, 0)).toBe(true)
})
test('notifyArgs: no shell, and quotes/backslashes cannot break out of the AppleScript string', () => {
  const a = notifyArgs('t"itle', 'x" & (do shell script "rm -rf ~") & "\\')
  expect(a[0]).toBe('osascript'); expect(a[1]).toBe('-e')
  expect(a[2]).toContain('t\\"itle')
  expect(a[2]).not.toMatch(/[^\\]" & \(do shell/)       // every inner quote is escaped
})
test('plistFor: valid plist (plutil -lint), interval in seconds, xml-escaped values', () => {
  const pl = plistFor({ bun: '/opt/homebrew/bin/bun', cli: '/a&b/<c>/cli.ts', everyMin: 30, thresholdGB: 20, cooldownH: 6, path: '/usr/bin:/bin', log: '/tmp/w.log' })
  expect(pl).toContain(LABEL); expect(pl).toContain('<integer>1800</integer>'); expect(pl).toContain('/a&amp;b/&lt;c&gt;/cli.ts')
  expect(pl).toContain('<string>check</string>'); expect(pl).toContain('<string>--threshold</string>')
  if (Bun.which('plutil')) { const f = join(mkdtempSync(join(tmpdir(), 'dpl-')), 'x.plist'); writeFileSync(f, pl); expect(Bun.spawnSync(['plutil', '-lint', f]).exitCode).toBe(0) }
})
test('message: carries free space, threshold and reclaimable amount', () => {
  const m = message(12.3e9, 20, 27.4e9); expect(m.title).toContain('12.30 GB'); expect(m.body).toContain('20 GB'); expect(m.body).toContain('27.40 GB')
})
