import type { Mod, Target } from '../core'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const MIN = 20e6
export default {
  id: 'android',
  async scan({ home, du, dirs, repos }) {
    const out: Target[] = [], sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(home, 'Library/Android/sdk')
    const bin = join(sdk, 'cmdline-tools/latest/bin'), avdRoot = join(home, '.android/avd')
    // --- AVDs
    const used = new Map<string, string>() // system image dir -> avd name
    for (const dir of dirs(avdRoot).filter(d => d.endsWith('.avd'))) {
      const name = dir.split('/').pop()!.replace(/\.avd$/, '')
      let cfg = ''; try { cfg = readFileSync(join(dir, 'config.ini'), 'utf8') } catch {}
      const img = /image\.sysdir\.1\s*=\s*(.+)/.exec(cfg)?.[1]?.trim().replace(/\/$/, ''); if (img) used.set(img, name)
      const snap = join(dir, 'snapshots'), ud = join(dir, 'userdata-qemu.img.qcow2'), owners = ['Android emulator']
      const [bs, bu, bt] = await Promise.all([du(snap), du(ud), du(dir)])
      if (bs >= MIN) out.push({ id: `android:avd-snapshots:${name}`, label: `AVD ${name} · quickboot snapshots`, bytes: bs, tier: 'A', regen: 'boot แบบ cold ครั้งแรกช้ากว่า แล้วสร้าง snapshot ใหม่', paths: [snap], action: { kind: 'rm', paths: [snap] }, owners })
      if (bu >= MIN) out.push({ id: `android:avd-userdata:${name}`, label: `AVD ${name} · userdata (ข้อมูลใน emulator)`, bytes: bu, tier: 'B', regen: 'emulator สร้างใหม่ตอน boot (เหมือน wipe data) · เสียแค่ข้อมูลใน emulator', paths: [ud], action: { kind: 'rm', paths: [ud] }, owners })
      const rest = Math.max(0, bt - bs - bu)
      if (rest >= MIN) out.push({ id: `android:avd:${name}`, label: `AVD ${name} (ส่วนที่เหลือ)`, bytes: rest, tier: 'C', regen: 'สร้าง AVD ใหม่ใน Android Studio Device Manager', paths: [dir, join(avdRoot, `${name}.ini`)], action: { kind: 'exec', argv: [join(bin, 'avdmanager'), 'delete', 'avd', '-n', name] }, owners, note: img ? `ใช้ image ${img.replace('system-images/', '')}` : undefined })
    }
    // --- system images
    for (const api of dirs(join(sdk, 'system-images'))) for (const variant of dirs(api)) for (const arch of dirs(variant)) {
      const bytes = await du(arch); if (bytes < MIN) continue
      const rel = `system-images/${api.split('/').pop()}/${variant.split('/').pop()}/${arch.split('/').pop()}`
      const user = used.get(rel), apiN = api.split('/').pop()!, varN = variant.split('/').pop()!
      out.push({ id: `android:image:${apiN}:${varN}`, label: `Android image ${apiN} · ${varN}`, bytes, tier: 'C', regen: 'ติดตั้งใหม่ผ่าน SDK Manager', paths: [arch], action: { kind: 'exec', argv: [join(bin, 'sdkmanager'), '--uninstall', `system-images;${apiN};${varN};${arch.split('/').pop()}`] }, note: user ? `ใช้โดย AVD ${user}` : `ไม่มี AVD ไหนใช้${/ps16k/.test(varN) ? ' (ps16k = ไว้เทส 16 KB page size)' : ''}` })
    }
    // --- NDKs: skip the one the app pins; note Flutter's default
    const pinned = new Set<string>()
    for (const r of repos()) for (const f of ['android/app/build.gradle', 'android/app/build.gradle.kts', 'android/build.gradle']) {
      try { const m = /ndkVersion\s*=?\s*['"]([\d.]+)['"]/.exec(readFileSync(join(r, f), 'utf8')); if (m) pinned.add(m[1]) } catch {}
    }
    let flutterDefault = ''; try { const fl = Bun.which('flutter')!; const root = join(fl, '../..'); flutterDefault = /val ndkVersion: String = "([\d.]+)"/.exec(readFileSync(join(root, 'packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt'), 'utf8'))?.[1] ?? '' } catch {}
    for (const p of dirs(join(sdk, 'ndk'))) {
      const v = p.split('/').pop()!; if (pinned.has(v)) continue
      const bytes = await du(p); if (bytes < MIN) continue
      out.push({ id: `android:ndk:${v}`, label: `Android NDK ${v}`, bytes, tier: 'C', regen: 'ติดตั้งใหม่ผ่าน SDK Manager (Gradle โหลดให้เองถ้าโปรเจกต์ต้องใช้)', paths: [p], action: { kind: 'exec', argv: [join(bin, 'sdkmanager'), '--uninstall', `ndk;${v}`] }, note: `โปรเจกต์ pin ${[...pinned].join(', ') || 'ไม่มี'}${v === flutterDefault ? ' · เป็นค่า default ของ Flutter (plugin ที่ไม่ pin อาจใช้)' : ''}` })
    }
    return out
  },
} satisfies Mod
