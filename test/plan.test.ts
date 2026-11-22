import { test, expect } from 'bun:test'
import { classify, questionKey } from '../src/plan'
import { homeView } from '../src/home'
import type { Target } from '../src/core'

const T = (id: string, tier: 'A' | 'B' | 'C', bytes: number, extra: Partial<Target> = {}): Target =>
  ({ id, label: id, bytes, tier, regen: 'ทำใหม่ได้', paths: [], action: { kind: 'rm', paths: [] }, module: id.split(':')[0], ...extra })
const SUDO: Target['action'] = { kind: 'sudo', cmd: 'sudo rm -rf /x' }
const targets = [
  T('gradle:transforms', 'A', 5e9, { owners: ['Gradle daemon'] }),               // owner is a daemon: stop it for the user
  T('dart:analysis-server', 'A', 2e9),
  T('vscode:cached-vsix', 'A', 3e8, { owners: ['Visual Studio Code'] }),         // owner is an app: skip
  T('xcode:sim-syscache', 'A', 3e9, { action: SUDO }),
  T('ai:hf:qwen', 'C', 4e9), T('ai:hf:llama', 'C', 2e9),
  T('android:avd-userdata:Pixel', 'B', 2.4e9),
]
const running = (o: string) => o === 'Gradle daemon' || o === 'Visual Studio Code'
const none = new Set<string>(), dk = { total: 500e9, avail: 40e9 }, opts = { details: false, msg: '', cols: 100 }

test('classify: tier A → auto / sudo / skip; stoppable daemon is stopped, app owner skips', () => {
  const p = classify(targets, running)
  expect(p.auto.map(t => t.id)).toEqual(['gradle:transforms', 'dart:analysis-server'])
  expect(p.sudo.map(t => t.id)).toEqual(['xcode:sim-syscache'])
  expect(p.skip.map(s => [s.t.id, s.owner])).toEqual([['vscode:cached-vsix', 'Visual Studio Code']])
  expect(p.stops).toEqual(['Gradle daemon'])
  expect(classify(targets, () => false).skip).toEqual([])                        // nothing running → nothing skipped, nothing stopped
  expect(classify(targets, () => false).stops).toEqual([])
})
test('classify: tier B/C never auto — grouped into one question per kind, biggest first, C wins the tier', () => {
  const p = classify(targets, running)
  expect(p.auto.some(t => t.tier !== 'A')).toBe(false)
  expect(p.ask.map(q => [q.key, q.tier, q.bytes])).toEqual([['ai:hf', 'C', 6e9], ['android:avd-userdata', 'B', 2.4e9]])
  expect(p.ask[0].targets.map(t => t.id)).toEqual(['ai:hf:qwen', 'ai:hf:llama'])
})
test('questionKey: groups by kind; projects group by what the folder is, not which project', () => {
  expect(questionKey({ id: 'ai:hf:qwen2.5-coder-7b' })).toBe('ai:hf')
  expect(questionKey({ id: 'flutter:sdk:flutter-3.35.0' })).toBe('flutter:sdk')
  expect(questionKey({ id: 'gradle:modules' })).toBe('gradle:modules')
  expect(questionKey({ id: 'projects:app:ios/Pods' })).toBe('projects:ios/Pods')
  expect(questionKey({ id: 'projects:other:ios/Pods' })).toBe('projects:ios/Pods')
})

const text = (v: { body: string[]; foot: string[] }) => [...v.body, ...v.foot].join('\n')
test('home: Enter button counts tier A only; every question starts unticked ("keep")', () => {
  const v = text(homeView(classify(targets, running), none, dk, opts))
  expect(v).toContain('ล้างเลย 7.00 GB')                                          // 5 + 2 — not the 8.4 GB of questions, not the 3 GB sudo
  expect(v).toContain('เก็บไว้'); expect(v).not.toContain('[x]')
  expect(v).toContain('หยุด Gradle daemon ให้เอง'); expect(v).toContain('ข้าม vscode:cached-vsix'); expect(v).toContain('อีก 3.00 GB ต้องใช้รหัสผ่านเครื่อง')
  expect(v).toContain('ว่าง 40.00 GB'); expect(v).toContain('47.00 GB')
})
test('home: answering "ลบ" adds to the total; a tier C answer switches the button to the DESTROY gate', () => {
  const p = classify(targets, running)
  const b = text(homeView(p, new Set(['android:avd-userdata']), dk, opts))       // tier B: still a single Enter
  expect(b).toContain('ล้างเลย 9.40 GB'); expect(b).toContain('[x]')
  const c = text(homeView(p, new Set(['ai:hf']), dk, opts))                      // tier C: needs confirmation
  expect(c).toContain('ไปยืนยัน 13.00 GB'); expect(c).not.toContain('ล้างเลย')
})
test('home: plain language on the first screen (no tier/preset/GATES jargon)', () => {
  const v = text(homeView(classify(targets, running), none, dk, opts))
  for (const jargon of ['tier', 'preset', 'GATES', 'allowlist']) expect(v).not.toContain(jargon)
  expect(v).not.toMatch(/DESTROY(?!ER)/)                                          // the brand name DESTROYER is fine; the typed-confirm word is not shown until needed
})
test('home: nothing to do is a clear one-liner; all-blocked says which apps to close', () => {
  expect(text(homeView(classify([], running), none, dk, opts))).toContain('เครื่องสะอาดแล้ว')
  const blocked = text(homeView(classify([targets[2]], running), none, dk, opts))
  expect(blocked).toContain('ตอนนี้ล้างไม่ได้'); expect(blocked).toContain('Visual Studio Code')
})
