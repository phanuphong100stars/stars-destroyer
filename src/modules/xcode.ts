import type { Mod, Target } from '../core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { slug, fmt } from '../core'
const MIN = 20e6
// bundle ids of the apps in your repos (extensions dropped) — used to find their data inside simulators
function bundleIds(repos: string[]) {
  const all = new Set<string>()
  for (const r of repos) { try { for (const m of readFileSync(join(r, 'ios/Runner.xcodeproj/project.pbxproj'), 'utf8').matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) { const id = m[1].replace(/"/g, '').trim(); if (id && !id.includes('$(')) all.add(id) } } catch {} }
  return [...all].filter(id => ![...all].some(o => id.startsWith(o + '.'))).sort((a, b) => b.length - a.length)
}
export default {
  id: 'xcode',
  detect: ({ has }) => has('xcrun'),
  async scan({ home, join: j, exists, du, dirs, sh, repos }) {
    const out: Target[] = [], dev = j(home, 'Library/Developer')
    const dd = j(dev, 'Xcode/DerivedData'), ds = j(dev, 'Xcode/iOS DeviceSupport'), sc = '/Library/Developer/CoreSimulator/Caches'
    const [bdd, bds, bsc] = await Promise.all([du(dd), du(ds), du(sc)])
    if (bdd >= MIN) out.push({ id: 'xcode:derived-data', label: 'Xcode DerivedData', bytes: bdd, tier: 'A', regen: 'Xcode build ใหม่ (ช้าครั้งแรก)', paths: [dd], action: { kind: 'rm', paths: [dd], keepDir: true }, owners: ['Xcode'] })
    if (bds >= MIN) out.push({ id: 'xcode:device-support', label: 'iOS DeviceSupport (symbol เครื่องจริง)', bytes: bds, tier: 'B', regen: 'เสียบเครื่องจริงแล้ว Xcode สร้างใหม่ (หลายนาที)', paths: [ds], action: { kind: 'rm', paths: [ds], keepDir: true }, owners: ['Xcode'] })
    if (bsc >= MIN) out.push({ id: 'xcode:sim-syscache', label: 'CoreSimulator system cache', bytes: bsc, tier: 'A', regen: 'sim boot ครั้งแรกช้ากว่า (สร้าง cache ใหม่)', paths: [sc], action: { kind: 'sudo', cmd: `sudo rm -rf ${sc}/*` }, owners: ['Simulator'], note: 'ต้อง sudo — hellbringer จะพิมพ์คำสั่งให้ ไม่รันเอง' })
    // simulators (devices + the app data inside)
    const list = JSON.parse((await sh`xcrun simctl list devices -j`.quiet().nothrow().text()) || '{}').devices ?? {}
    const bundles = bundleIds(repos()), devCount: Record<string, number> = {}
    for (const [rt, devs] of Object.entries<any>(list)) {
      const rtn = rt.replace('com.apple.CoreSimulator.SimRuntime.', '').toLowerCase(), pretty = rtn.replace(/^ios-/, 'iOS ').replace('-', '.')
      devCount[rt] = devs.length
      for (const d of devs) {
        const dir = j(dev, 'CoreSimulator/Devices', d.udid); if (!exists(dir)) continue
        const bytes = await du(dir); if (bytes < 100e6) continue
        const key = `${slug(d.name)}-${rtn}`
        out.push({ id: `xcode:sim:${key}`, label: `Simulator ${d.name} (${pretty})`, bytes, tier: 'C', regen: 'ลบ = เครื่องใหม่ ต้องติดตั้งแอปใหม่ (flutter run ลงให้)', paths: [dir], action: { kind: 'exec', argv: ['xcrun', 'simctl', 'delete', d.udid] }, owners: d.state === 'Booted' ? ['Simulator'] : undefined, note: `${d.udid.slice(0, 8)}…` })
        for (const c of dirs(j(dir, 'data/Containers/Data/Application'))) {
          let buf: Buffer; try { buf = readFileSync(j(c, '.com.apple.mobile_container_manager.metadata.plist')) } catch { continue }
          const bid = bundles.find(b => buf.includes(b)); if (!bid) continue
          const paths = [j(c, 'Library/Caches'), j(c, 'tmp')], b = await du(paths); if (b < MIN) continue
          out.push({ id: `xcode:sim-appcache:${key}:${bid.split('.').pop()}`, label: `${d.name} (${pretty}) · cache + tmp ของแอป`, bytes: b, tier: 'A', regen: 'แอปโหลดรูป/สร้างไฟล์ใหม่เอง · ไม่แตะ session/ตั้งค่า', paths, action: { kind: 'rm', paths, keepDir: true }, owners: ['Simulator'], note: bid })
        }
      }
    }
    // simulator runtimes
    const rts = JSON.parse((await sh`xcrun simctl runtime list -j`.quiet().nothrow().text()) || '{}')
    for (const [uuid, r] of Object.entries<any>(rts)) {
      if (!(r.sizeBytes >= MIN)) continue
      out.push({ id: `xcode:runtime:${slug(String(r.version))}`, label: `Simulator runtime iOS ${r.version} (${r.build})`, bytes: r.sizeBytes, tier: 'C', regen: `โหลดใหม่ใน Xcode Settings → Components (~${fmt(r.sizeBytes)})`, paths: [], action: { kind: 'exec', argv: ['xcrun', 'simctl', 'runtime', 'delete', uuid] }, note: `device บน runtime นี้ ${devCount[r.runtimeIdentifier] ?? '?'} เครื่อง (ลบ runtime = device บนนั้นใช้ไม่ได้)` })
    }
    return out
  },
} satisfies Mod
