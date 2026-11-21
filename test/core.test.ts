import { test, expect } from 'bun:test'
import { checkPath, validateTarget, resolveSet, globRe, fmt, renderTargetToml, saveSet, setDefault, HOME, type Target } from '../src/core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const T = (id: string, tier: 'A' | 'B' | 'C'): Target => ({ id, label: id, bytes: 1e9, tier, regen: 'x', paths: [], action: { kind: 'exec', argv: ['true'] } })
const targets = [T('gradle:transforms', 'A'), T('android:avd-userdata:Pixel', 'B'), T('android:ndk:28.2.1', 'C'), T('android:ndk:27.0.1', 'C'), T('xcode:sim:iphone-18-pro-max-ios-27-0', 'C')]

test('checkPath: refuses wide / protected / outside-home paths, allows deep cache paths', () => {
  expect(checkPath(HOME)).toContain('home')
  expect(checkPath(HOME + '/Library')).toBeTruthy()
  expect(checkPath(HOME + '/Project')).toBeTruthy()
  expect(checkPath(HOME + '/.ssh/id_rsa')).toBeTruthy()
  expect(checkPath(HOME + '/.claude/projects')).toBeTruthy()
  expect(checkPath('/etc/hosts')).toBeTruthy()
  expect(checkPath(HOME + '/a/../.ssh')).toBeTruthy()
  expect(checkPath(HOME + '/.gradle/caches/8.14.3')).toBeNull()
  expect(checkPath(HOME + '/flutter-3.35.0')).toBeNull()
  expect(checkPath('/Library/Developer/CoreSimulator/Caches')).toBeNull()
})
test('validateTarget: tier D and unsafe rm paths are rejected', () => {
  const ok = { ...T('a', 'A'), action: { kind: 'rm' as const, paths: [HOME + '/.gradle/caches/8.14.3'] } }
  expect(validateTarget(ok)).toEqual([])
  expect(validateTarget({ ...ok, tier: 'D' as any }).join()).toContain('tier')
  expect(validateTarget({ ...ok, action: { kind: 'rm', paths: [HOME] } }).length).toBeGreaterThan(0)
  expect(validateTarget({ ...ok, action: { kind: 'sudo', cmd: 'rm -rf /' } }).length).toBeGreaterThan(0)
})
test('resolveSet: tier set never pulls in tier C; only= patterns + include dedupe; missing reported', () => {
  const defs = { safe: { tier: 'A' as const }, stale: { only: ['android:avd-userdata:*', 'android:ndk:28.*', 'nothing:*'] }, all: { include: ['safe', 'stale'] } }
  expect([...resolveSet('safe', defs, targets).ids]).toEqual(['gradle:transforms'])
  const r = resolveSet('all', defs, targets)
  expect([...r.ids].sort()).toEqual(['android:avd-userdata:Pixel', 'android:ndk:28.2.1', 'gradle:transforms'])
  expect(r.missing).toEqual(['nothing:*'])
  expect(() => resolveSet('x', { x: { tier: 'C' as any } }, targets)).toThrow('tier C')
  expect(() => resolveSet('a', { a: { include: ['b'] }, b: { include: ['a'] } }, targets)).toThrow('วนกัน')
})
test('globRe + fmt + targets.toml roundtrip', () => {
  expect(globRe('android:ndk:28.*').test('android:ndk:28.2.13676358')).toBe(true)
  expect(globRe('android:ndk:28.*').test('android:ndk:27.0.1')).toBe(false)
  expect(fmt(1.5e9)).toBe('1.50 GB'); expect(fmt(794e6)).toBe('794 MB')
  const e = { id: 'x', label: 'a · b', path: '~/Library/Application Support/Code/models', tier: 'B', regen: 'โหลดใหม่ "ได้"', owners: ['Visual Studio Code'] }
  const parsed: any = Bun.TOML.parse(renderTargetToml(e))
  expect(parsed.target[0]).toEqual(e)
})

test('set save / default: appends a set, keeps your comments, refuses duplicates, default goes above tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcfg-')), f = join(dir, 'sets.toml')
  writeFileSync(f, '# my comment\n[sets.mine]\nonly = ["a:*"]\n')
  saveSet('weekly', ['gradle:*', 'projects:*:.dart_tool'], dir)
  expect(() => saveSet('weekly', ['x'], dir)).toThrow('มีชุด')
  setDefault('weekly', dir); setDefault('mine', dir)                       // second call replaces, never duplicates
  const txt = readFileSync(f, 'utf8'), parsed: any = Bun.TOML.parse(txt)
  expect(txt).toContain('# my comment'); expect(txt.match(/^default/gm)!.length).toBe(1)
  expect(parsed.default).toBe('mine'); expect(parsed.sets.weekly.only).toEqual(['gradle:*', 'projects:*:.dart_tool']); expect(parsed.sets.mine.only).toEqual(['a:*'])
})
