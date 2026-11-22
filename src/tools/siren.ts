// siren: send a saved test push / deep link into a BOOTED iOS Simulator or Android EMULATOR. Local test devices only — never a real phone, never a server.
// Saved items live in ~/.config/destroyer/siren.toml. Nothing here deletes or edits anything on disk.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, short } from '../core'
import { out, c, rule } from '../ui'

export type Push = { name: string; bundle: string; payload: string }
export type Link = { name: string; url: string; package?: string }
export type Device = { kind: 'ios' | 'android'; id: string; name: string }
export type Io = { run(argv: string[], stdin?: string): { code: number; err: string } }

export const EXAMPLE = `# ~/.config/destroyer/siren.toml — รายการที่เซฟไว้ (ตัวอย่าง แก้ bundle/url ให้ตรงกับแอปของคุณ)
[[push]]
name = "ข้อความใหม่"
bundle = "com.example.app"
payload = '{"aps":{"alert":{"title":"ทดสอบ","body":"ข้อความใหม่"},"sound":"default"}}'

[[link]]
name = "โปรไฟล์"
url = "myapp://profile/123"
package = "com.example.app"   # Android: ไม่ใส่ก็ได้
`

// ---------- validation: everything that reaches a command line was checked first ----------
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
const URL_OK = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"`\\<>\x00-\x1f]*$/   // no quote/whitespace: the Android command wraps the url in single quotes
const UDID = /^[0-9A-Fa-f-]{36}$/
const EMULATOR = /^emulator-\d+$/
export function parseSiren(toml: string): { push: Push[]; link: Link[]; errors: string[] } {
  const errors: string[] = []; let raw: any
  try { raw = Bun.TOML.parse(toml) } catch (e) { return { push: [], link: [], errors: [`อ่านไฟล์ไม่ได้: ${e}`] } }
  const push: Push[] = [], link: Link[] = []
  for (const p of raw.push ?? []) {
    const at = `push "${p.name}"`
    if (!p.name || typeof p.name !== 'string') { errors.push('push: ต้องมี name'); continue }
    if (!BUNDLE.test(p.bundle ?? '')) { errors.push(`${at}: bundle ไม่ถูกต้อง`); continue }
    let j: any; try { j = JSON.parse(p.payload) } catch { errors.push(`${at}: payload ต้องเป็น JSON`); continue }
    if (!j || typeof j.aps !== 'object' || j.aps === null) { errors.push(`${at}: payload ต้องมี "aps"`); continue }
    if (Buffer.byteLength(p.payload) > 4096) { errors.push(`${at}: payload เกิน 4096 ไบต์`); continue }
    push.push({ name: p.name, bundle: p.bundle, payload: p.payload })
  }
  for (const l of raw.link ?? []) {
    const at = `link "${l.name}"`
    if (!l.name || typeof l.name !== 'string') { errors.push('link: ต้องมี name'); continue }
    if (!URL_OK.test(l.url ?? '')) { errors.push(`${at}: url ต้องเป็น scheme://… ไม่มีช่องว่างหรือเครื่องหมายคำพูด`); continue }
    if (l.package != null && !PACKAGE.test(l.package)) { errors.push(`${at}: package ไม่ถูกต้อง`); continue }
    link.push({ name: l.name, url: l.url, package: l.package })
  }
  return { push, link, errors }
}

// ---------- devices ----------
export function parseBooted(json: string): Device[] {
  try { return Object.values<any[]>(JSON.parse(json).devices ?? {}).flat().filter(d => d.state === 'Booted' && UDID.test(d.udid)).map(d => ({ kind: 'ios' as const, id: d.udid, name: d.name })) } catch { return [] }
}
export function parseAdb(text: string): Device[] {   // emulators that are fully up; physical phones (any other serial) are never listed
  return text.split('\n').map(l => l.trim().split(/\s+/)).filter(([s, st]) => EMULATOR.test(s ?? '') && st === 'device').map(([s]) => ({ kind: 'android' as const, id: s, name: s }))
}
export function chooseTargets(devs: Device[], kind: 'push' | 'link', want?: string, all = false): { targets: Device[]; problem?: string } {
  const pool = kind === 'push' ? devs.filter(d => d.kind === 'ios') : devs
  if (want) { const d = pool.find(x => x.id === want); return d ? { targets: [d] } : { targets: [], problem: `ไม่พบ "${want}" ในเครื่องทดสอบที่เปิดอยู่ (ยิงได้เฉพาะ simulator/emulator)` } }
  if (!pool.length) return { targets: [], problem: kind === 'push' ? 'ไม่มี iOS Simulator เปิดอยู่ — เปิดก่อนแล้วลองใหม่ (push ทดสอบรองรับเฉพาะ iOS Simulator)' : 'ไม่มี simulator หรือ emulator เปิดอยู่ — เปิดก่อนแล้วลองใหม่' }
  if (pool.length > 1 && !all) return { targets: [], problem: `มี ${pool.length} เครื่องเปิดอยู่: ${pool.map(d => `${d.name} (${d.id})`).join(', ')} — ใส่ --device <id> หรือ --all` }
  return { targets: pool }
}

// ---------- the commands (argv arrays; the one string that reaches a device shell has its url single-quoted) ----------
export const iosPush = (udid: string, bundle: string) => ['xcrun', 'simctl', 'push', udid, bundle, '-']   // payload goes to stdin
export const iosLink = (udid: string, url: string) => ['xcrun', 'simctl', 'openurl', udid, url]
export const androidLink = (serial: string, url: string, pkg?: string) => ['adb', '-s', serial, 'shell', `am start -a android.intent.action.VIEW -d '${url}'${pkg ? ` -p ${pkg}` : ''}`]
export function planFor(kind: 'push' | 'link', item: Push | Link, d: Device): { argv: string[]; stdin?: string } {
  if (kind === 'push') { const p = item as Push; return { argv: iosPush(d.id, p.bundle), stdin: p.payload } }
  const l = item as Link; return { argv: d.kind === 'ios' ? iosLink(d.id, l.url) : androidLink(d.id, l.url, l.package) }
}
export function send(kind: 'push' | 'link', item: Push | Link, targets: Device[], io: Io, dry: boolean): string[] {
  return targets.map(d => {
    const { argv, stdin } = planFor(kind, item, d)
    if (dry) return `${c.dim('would:')} ${argv.map(a => (/[^\w@%+=:,./-]/.test(a) ? `'${a}'` : a)).join(' ')}${stdin ? c.dim(`  < payload ${stdin.length} ตัวอักษร`) : ''}`
    const r = io.run(argv, stdin)
    return r.code === 0 ? `${c.gr('✓')} ส่ง “${item.name}” ไป ${d.name}` : `${c.rd('✗')} ส่งไป ${d.name} ไม่สำเร็จ: ${(r.err.trim() || `exit ${r.code}`).slice(0, 160)}`
  })
}

const sh = (argv: string[], stdin?: string) => { try { const r = Bun.spawnSync(argv, stdin ? { stdin: Buffer.from(stdin) } : {}); return { code: r.exitCode ?? 1, out: new TextDecoder().decode(r.stdout), err: new TextDecoder().decode(r.stderr) } } catch (e) { return { code: 127, out: '', err: String(e) } } }
export const realIo: Io = { run: (argv, stdin) => { const r = sh(argv, stdin); return { code: r.code, err: r.err } } }
export const discover = (): Device[] => [...parseBooted(sh(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j']).out), ...parseAdb(sh(['adb', 'devices']).out)]
export const sirenFile = () => join(process.env.DESTROYER_CONFIG ?? CONFIG, 'siren.toml')   // read at call time so tests can point it at a temp dir

export async function runSiren(a: { sub: string; name?: string; flag: (n: string) => string | undefined; has: (n: string) => boolean }, io: Io = realIo, devices: () => Device[] = discover): Promise<number> {
  const file = sirenFile(), cfg = existsSync(file) ? parseSiren(readFileSync(file, 'utf8')) : { push: [], link: [], errors: [] as string[] }
  const devs = devices()
  if (a.sub === 'status') {
    out(rule('SIREN — ยิง push / deep link ทดสอบ', c.dim, c.dim('เฉพาะ simulator / emulator')))
    out(devs.length ? devs.map(d => `  ${c.gr('●')} ${d.kind === 'ios' ? 'iOS ' : 'ADR '} ${d.name} ${c.dim(d.id)}`).join('\n') : `  ${c.dim('○ ไม่มี simulator หรือ emulator เปิดอยู่ — เปิดก่อน แล้วจึงยิงได้')}`)
    out(); out(`  ${c.b('รายการที่เซฟไว้')} ${c.dim(short(file))}`)
    if (!existsSync(file)) { out(c.dim('  ยังไม่มีไฟล์ — สร้างตามตัวอย่างนี้ (ผมไม่สร้างให้ เพราะ bundle id ต้องเป็นของแอปคุณ):')); out(); out(EXAMPLE.split('\n').map(l => '    ' + c.dim(l)).join('\n')); return 0 }
    for (const p of cfg.push) out(`  ${c.am('push')} ${p.name} ${c.dim('· ' + p.bundle)}`)
    for (const l of cfg.link) out(`  ${c.bl('link')} ${l.name} ${c.dim('· ' + l.url)}`)
    for (const e of cfg.errors) out(`  ${c.rd('✗')} ${e}`)
    out(); out(c.dim('  ใช้:  hellbringer siren push <ชื่อ> | link <ชื่อ>   [--device <id>] [--all] [--dry-run]'))
    return cfg.errors.length ? 1 : 0
  }
  if (a.sub !== 'push' && a.sub !== 'link') { out(c.rd('✗ ') + 'ใช้: hellbringer siren [status] | push <ชื่อ> | link <ชื่อ>'); return 1 }
  if (cfg.errors.length) { cfg.errors.forEach(e => out(c.rd('✗ ') + e)); return 1 }
  const list = a.sub === 'push' ? cfg.push : cfg.link, hit = list.filter(i => i.name === a.name), part = list.filter(i => a.name && i.name.startsWith(a.name)), item = hit[0] ?? (part.length === 1 ? part[0] : undefined)
  if (!a.name || !item) { out(c.rd('✗ ') + (a.name && part.length > 1 ? `ชื่อ “${a.name}” ตรงหลายรายการ: ${part.map(i => i.name).join(', ')}` : `ไม่พบ ${a.sub} ชื่อ “${a.name ?? ''}” ใน ${short(file)}`)); return 1 }
  const { targets, problem } = chooseTargets(devs, a.sub, a.flag('device'), a.has('all'))
  if (problem) { out(c.am('! ') + problem); return 2 }
  const lines = send(a.sub, item, targets, io, a.has('dry-run')); lines.forEach(l => out(l))
  return lines.some(l => l.includes('✗')) ? 1 : 0
}
