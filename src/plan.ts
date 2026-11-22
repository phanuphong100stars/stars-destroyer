// plan: sort scan results into what the home screen shows — do now (auto) / yes-no questions (ask). Pure: process checks are injected so tests need no running apps.
import type { Target } from './core'
import { runningOwner, stoppable } from './exec'

export type Question = { key: string; title: string; tier: 'B' | 'C'; targets: Target[]; bytes: number; why: string }
export type Plan = {
  auto: Target[]                              // tier A: Enter cleans these, no questions
  sudo: Target[]                              // tier A but needs root: printed at the end, never run
  skip: { t: Target; owner: string }[]        // tier A but the owner app is running (and can't be stopped for you)
  stops: string[]                             // daemons that will be stopped automatically (they restart by themselves)
  ask: Question[]                             // tier B/C grouped into one yes/no each — default answer is "keep"
}

export const GROUP: Record<string, string> = { gradle: 'cache ของ Gradle', dart: 'cache ของ Dart analysis', android: 'snapshot ของ Android emulator', xcode: 'cache ของ Xcode / Simulator', projects: 'ไฟล์ build ในโปรเจกต์', vscode: 'cache ของ VS Code' }
const TITLE: Record<string, string> = {
  'ai:hf': 'โมเดล AI (Hugging Face)', 'flutter:sdk': 'Flutter SDK เก่า', 'xcode:sim': 'iOS Simulator', 'xcode:runtime': 'iOS Simulator runtime',
  'android:avd-userdata': 'ข้อมูลใน Android emulator', 'android:avd': 'Android emulator ทั้งเครื่อง', 'android:image': 'Android system image', 'android:ndk': 'Android NDK',
  'gradle:modules': 'dependency ที่ Gradle โหลดไว้', 'dart:pub-cache': 'pub-cache', 'projects:node_modules': 'node_modules ในโปรเจกต์', 'projects:ios/Pods': 'CocoaPods ในโปรเจกต์',
}
const sum = (ts: Target[]) => ts.reduce((a, t) => a + t.bytes, 0)

// one question per kind of thing: ai:hf:* → "ai:hf", projects:app:node_modules → "projects:node_modules"
export function questionKey(t: Pick<Target, 'id'>): string {
  const p = t.id.split(':')
  return p[0] === 'projects' ? `projects:${p.slice(2).join(':')}` : p.slice(0, 2).join(':')
}

export function classify(targets: Target[], running: (owner: string) => boolean = o => runningOwner(o).length > 0): Plan {
  const plan: Plan = { auto: [], sudo: [], skip: [], stops: [], ask: [] }, qs = new Map<string, Target[]>(), stops = new Set<string>()
  for (const t of targets) {
    if (t.tier !== 'A') { const k = questionKey(t); qs.set(k, [...(qs.get(k) ?? []), t]); continue }
    const own = t.owners ?? [], hard = own.find(o => running(o) && !stoppable(o))
    if (hard) { plan.skip.push({ t, owner: hard }); continue }
    own.filter(o => running(o) && stoppable(o)).forEach(o => stops.add(o))
    ;(t.action.kind === 'sudo' ? plan.sudo : plan.auto).push(t)
  }
  plan.stops = [...stops]
  plan.ask = [...qs].map(([key, ts]) => ({
    key, title: TITLE[key] ?? key, tier: ts.some(t => t.tier === 'C') ? 'C' as const : 'B' as const, targets: ts, bytes: sum(ts),
    why: `${ts.slice(0, 3).map(t => t.label).join(' · ')}${ts.length > 3 ? ` +${ts.length - 3}` : ''} — ${ts[0].regen}`,
  })).sort((a, b) => b.bytes - a.bytes)
  return plan
}
