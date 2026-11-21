import { test, expect } from 'bun:test'
import { checkPath, validateTarget, globRe, fmt, loadPreset, inPreset, presetMissing, HOME, type Target } from '../src/core'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
test('globRe + fmt', () => {
  expect(globRe('android:ndk:28.*').test('android:ndk:28.2.13676358')).toBe(true)
  expect(globRe('android:ndk:28.*').test('android:ndk:27.0.1')).toBe(false)
  expect(fmt(1.5e9)).toBe('1.50 GB'); expect(fmt(794e6)).toBe('794 MB')
})

const P = { name: 't', allow: ['gradle:transforms', 'projects:*:.dart_tool', 'android:ndk:28.*'] }
test('inPreset: exact + wildcard match; everything else is outside', () => {
  expect(inPreset('gradle:transforms', P)).toBe(true); expect(inPreset('projects:demo:.dart_tool', P)).toBe(true); expect(inPreset('android:ndk:28.2.1', P)).toBe(true)
  for (const id of ['gradle:modules', 'projects:demo:node_modules', 'android:ndk:27.0.1', 'xcode:runtime:26.5', 'gradle:transforms2', '']) expect(inPreset(id, P)).toBe(false)
})
test('presetMissing: reports patterns with no target on this machine', () => {
  const t = (id: string) => ({ id } as Target)
  expect(presetMissing([t('gradle:transforms')], P)).toEqual(['projects:*:.dart_tool', 'android:ndk:28.*'])
})
test('loadPreset: the shipped preset is valid, specific, and bounded; broad patterns are rejected', () => {
  const shipped = loadPreset(); expect(shipped.allow.length).toBeGreaterThan(5); expect(shipped.allow.length).toBeLessThan(40)
  for (const g of shipped.allow) { expect(g).toMatch(/^[a-z][a-z-]*:\S+$/); expect(g).not.toMatch(/^[a-z][a-z-]*:\*+$/) }
  const tmp = (body: string) => { const f = join(mkdtempSync(join(tmpdir(), 'dpr-')), 'p.toml'); writeFileSync(f, body); return f }
  expect(() => loadPreset(tmp('allow = ["*"]'))).toThrow('ไม่ถูกต้อง')
  expect(() => loadPreset(tmp('allow = ["projects:*"]'))).toThrow('กว้างเกินไป')
  expect(() => loadPreset(tmp('allow = []'))).toThrow('อย่างน้อย')
  expect(() => loadPreset(tmp('name = "x"'))).toThrow()
})
