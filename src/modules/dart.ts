import type { Mod, Target } from '../core'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
export default {
  id: 'dart',
  async scan({ home, join, exists, du }) {
    const out: Target[] = [], MIN = 20e6
    const as = join(home, '.dartServer/.analysis-driver'), pub = join(home, '.pub-cache/hosted')
    const fl = Bun.which('flutter'); const active = fl ? dirname(dirname(realpathSync(fl))) : ''
    const sdks = readdirSync(home).filter(n => /^flutter/i.test(n)).map(n => join(home, n)).filter(p => p !== active)
    const [bAs, bPub, ...bSdk] = await Promise.all([du(as), du(pub), ...sdks.map(p => du(p))]) // du is the slow part — run together
    if (exists(as)) { const bytes = bAs; if (bytes >= MIN) out.push({ id: 'dart:analysis-server', label: 'Dart analysis server cache', bytes, tier: 'A', regen: 'IDE index ใหม่ตอนเปิดโปรเจกต์ครั้งหน้า', paths: [as], action: { kind: 'rm', paths: [as] }, owners: ['IDE (Dart analysis server)'] }) }
    if (exists(pub)) { const bytes = bPub; if (bytes >= MIN) out.push({ id: 'dart:pub-cache', label: 'pub-cache (package ที่ใช้ร่วมทุกโปรเจกต์)', bytes, tier: 'B', regen: 'flutter pub get ทุกโปรเจกต์ (ใช้เน็ต)', paths: [pub], action: { kind: 'rm', paths: [pub] } }) }
    // other Flutter SDK copies in $HOME (not the one `flutter` on PATH uses)
    for (const [i, p] of sdks.entries()) {
      const n = p.split('/').pop()!, bytes = bSdk[i]; if (bytes < MIN) continue
      let ver = ''; try { ver = readFileSync(join(p, 'version'), 'utf8').trim() } catch {}
      out.push({ id: `flutter:sdk:${n}`, label: `Flutter SDK เก่า ${n}`, bytes, tier: 'C', regen: 'git clone ใหม่ (ต้องเน็ต)', paths: [p], action: { kind: 'rm', paths: [p] }, note: `${ver ? 'version ' + ver + ' · ' : ''}ตรวจก่อนว่า script (เช่น downgrade_flutter.sh) ไม่ชี้มาที่นี่` })
    }
    return out
  },
} satisfies Mod
