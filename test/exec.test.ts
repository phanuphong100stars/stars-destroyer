import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, realpathSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyTarget, checkExec, runningOwner, ownerPattern } from '../src/exec'
import { validateTarget, type Target } from '../src/core'

let home = '', outside = ''
beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), 'dhome-'))); outside = realpathSync(mkdtempSync(join(tmpdir(), 'dout-'))); writeFileSync(join(outside, 'precious.txt'), 'keep me') })
const PRE = { name: 't', allow: ['t'] }
const rmT = (paths: string[], keepDir = false): Target => ({ id: 't', label: 't', bytes: 5e8, tier: 'A', regen: 'x', paths, action: { kind: 'rm', paths, keepDir } })

test('rm: removes the folder, reports done with bytes', async () => {
  const d = join(home, '.gradle/caches/8.14.3'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a.bin'), 'x')
  const r = await applyTarget(rmT([d]), { home, preset: PRE }); expect(r.status).toBe('done'); expect(r.bytes).toBe(5e8); expect(existsSync(d)).toBe(false)
})
test('rm keepDir: children removed, folder stays; missing path = skipped', async () => {
  const d = join(home, 'Library/Developer/Xcode/DerivedData'); mkdirSync(join(d, 'proj'), { recursive: true }); writeFileSync(join(d, 'proj/x'), 'x')
  expect((await applyTarget(rmT([d], true), { home, preset: PRE })).status).toBe('done'); expect(existsSync(d)).toBe(true); expect(readdirSync(d)).toEqual([])
  expect((await applyTarget(rmT([join(home, '.cache/nope/x')]), { home, preset: PRE })).status).toBe('skipped')
})
test('symlink inside a target: only the link is removed, the outside file survives', async () => {
  const d = join(home, '.cache/huggingface/hub/m'); mkdirSync(d, { recursive: true }); symlinkSync(join(outside, 'precious.txt'), join(d, 'link')); symlinkSync(outside, join(d, 'dirlink'))
  expect((await applyTarget(rmT([d]), { home, preset: PRE })).status).toBe('done')
  expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep me')
})
test('target that IS a symlink, outside-home, and too-wide paths are refused (nothing deleted)', async () => {
  const link = join(home, '.cache/evil'); mkdirSync(join(home, '.cache'), { recursive: true }); symlinkSync(outside, link)
  const r1 = await applyTarget(rmT([link]), { home, preset: PRE }); expect(r1.status).toBe('failed'); expect(r1.message).toContain('symlink')
  expect((await applyTarget(rmT([outside]), { home, preset: PRE })).status).toBe('failed')
  expect((await applyTarget(rmT([home]), { home, preset: PRE })).status).toBe('failed')
  expect((await applyTarget(rmT([join(home, 'Library')]), { home, preset: PRE })).status).toBe('failed')
  expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
})
test('dry-run deletes nothing; sudo is only printed', async () => {
  const d = join(home, '.gradle/caches/8.14.3'); mkdirSync(d, { recursive: true })
  expect((await applyTarget(rmT([d]), { home, dryRun: true, preset: PRE })).status).toBe('dry'); expect(existsSync(d)).toBe(true)
  const s: Target = { ...rmT([]), action: { kind: 'sudo', cmd: 'sudo rm -rf /Library/Developer/CoreSimulator/Caches/*' } }
  const r = await applyTarget(s, { home, preset: PRE }); expect(r.status).toBe('printed'); expect(r.cmd).toContain('sudo rm')
})
test('exec allowlist: only owner tools in known shapes', () => {
  const u = '9ABE4519-2D91-4A60-BE6D-574410B0B499'
  expect(checkExec(['xcrun', 'simctl', 'delete', u])).toBeNull()
  expect(checkExec(['xcrun', 'simctl', 'runtime', 'delete', u])).toBeNull()
  expect(checkExec(['/x/avdmanager', 'delete', 'avd', '-n', 'Medium_Phone'])).toBeNull()
  expect(checkExec(['/x/sdkmanager', '--uninstall', 'ndk;28.2.13676358'])).toBeNull()
  for (const bad of [['rm', '-rf', '/'], ['sh', '-c', 'x'], ['xcrun', 'simctl', 'erase', 'all'], ['xcrun', 'simctl', 'delete', 'all'], ['sdkmanager', '--uninstall', 'ndk;1; rm -rf ~'], ['avdmanager', 'delete', 'avd', '-n', 'a b']]) expect(checkExec(bad)).toBeTruthy()
  const t: Target = { ...rmT([]), action: { kind: 'exec', argv: ['rm', '-rf', '/'] } }; expect(validateTarget(t).join()).toContain('allowlist')
})
test('runningOwner: unknown app is not running; this very test process is excluded', () => { expect(runningOwner('Definitely Not An App 12345')).toEqual([]) })
test('ownerPattern: Electron apps match the whole bundle; Xcode stays specific; unknown apps use <name>.app/', () => {
  expect(ownerPattern('Visual Studio Code')).toBe('Visual Studio Code.app/')
  expect(ownerPattern('Xcode')).toBe('Xcode.app/Contents/MacOS/Xcode')
  expect(ownerPattern('Brave Browser')).toBe('Brave Browser.app/')
  expect(ownerPattern('Gradle daemon')).toBe('GradleDaemon')
})
test('PRESET LOCK: a target outside the preset is refused — nothing deleted, not even in a valid home path, whoever calls', async () => {
  const d = join(home, '.gradle/caches/8.14.3'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a'), 'x')
  const outsider: Target = { ...rmT([d]), id: 'gradle:modules' }                       // valid path, valid action — but not in the preset
  const r = await applyTarget(outsider, { home, preset: PRE })
  expect(r.status).toBe('failed'); expect(r.message).toContain('preset'); expect(existsSync(d)).toBe(true)
  expect((await applyTarget({ ...outsider, id: 't' }, { home, preset: PRE })).status).toBe('done')   // same target under an allowed id works
  expect((await applyTarget({ ...rmT([]), id: 'xcode:runtime:26.5', action: { kind: 'exec', argv: ['xcrun', 'simctl', 'runtime', 'delete', '9ABE4519-2D91-4A60-BE6D-574410B0B499'] } }, { home, preset: PRE })).status).toBe('failed')
})
