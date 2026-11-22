#!/usr/bin/env bun
// destroyer — ล็อกเป็น preset เดียว (config/preset.toml): แสดงเฉพาะสิ่งที่จะล้าง และลบได้แค่นั้น
import { fmt, makeCtx, load, scan, preset, presetMissing, globRe, saveCache, cacheStats, type Target } from './core'
import { out, c, tierC, banner, rule, rail, Live, SPIN, live } from './ui'
import { sum, disk, meter, printTargets, summary, infoLines } from './view'
import { pick } from './tui'
import { homeScreen } from './home'
import { applyFlow } from './apply'
import { runWatch } from './watch'
import pkg from '../package.json'

const args = process.argv.slice(2)
const first = args[0] && !args[0].startsWith('--') ? args[0] : undefined
const cmd = first ?? (args.length && !args.every(a => a === '--pick' || a === '--fresh') ? 'scan' : 'home'), rest = first ? args.slice(1) : args   // flags alone mean "scan", except --pick/--fresh which modify the main screen
const flag = (n: string) => { const i = rest.indexOf('--' + n); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined }
const has = (n: string) => rest.includes('--' + n), json = has('json')
const die = (m: string): never => { out(c.rd('✗ ') + m); process.exit(1) }
const LOCKED = 'destroyer ล็อกเป็น preset เดียว — ทำได้เฉพาะรายการใน config/preset.toml (แก้ไฟล์นั้นที่ repo ถ้าจะเปลี่ยนขอบเขต)'

type Row = { s: 'run' | 'ok' | 'skip' | 'fail'; n?: number; bytes?: number; ms?: number; why?: string }
async function doScan(show: boolean) {
  const ctx = makeCtx(), mods = await load(ctx), rows = new Map<string, Row>(), reporters = new Set(mods.filter(l => l.mod.kind === 'reporter').map(l => l.mod.id))
  for (const l of mods) rows.set(l.mod.id, l.status === 'skipped' ? { s: 'skip', why: l.why } : { s: 'run' })
  const render = (f: number) => [...rows].map(([id, r]) => r.s === 'run' ? `${c.vi(SPIN[f % 10])} ${id.padEnd(16)} ${c.dim('…')}`
    : r.s === 'ok' ? `${c.gr('✓')} ${id.padEnd(16)} ${String(r.n).padStart(3)} ${c.dim(reporters.has(id) ? 'notes  ' : 'targets')} ${(r.bytes ? fmt(r.bytes) : '—').padStart(9)}  ${c.dim(((r.ms ?? 0) / 1000).toFixed(1) + 's')}`
    : r.s === 'skip' ? `${c.dim('○ ' + id.padEnd(16) + ' ' + (r.why ?? 'skipped'))}` : `${c.rd('✗')} ${id.padEnd(16)} ${c.rd((r.why ?? '').slice(0, 60))}`)
  const lv = new Live(render)
  if (show) { out(rule('SCAN')); lv.start() }
  const res = await scan(ctx, mods, { done: (id, n, bytes, ms) => rows.set(id, { s: 'ok', n, bytes, ms }), fail: (id, why) => rows.set(id, { s: 'fail', why }) })
  if (show) { lv.stop(); if (!live) render(0).forEach(l => out(l)) }
  saveCache(); return { ctx, mods, ...res }
}
const cacheNote = () => { if (cacheStats.hits) out(c.dim(`ขนาดบางส่วนมาจาก cache (เก่าสุด ${Math.max(1, Math.round(cacheStats.oldestMs / 60000))} นาที) — destroyer --fresh เพื่อวัดใหม่ทั้งหมด`)) }

async function main() {
  if (['add', 'new', 'check', 'discover', 'set', 'modules'].includes(cmd)) die(`คำสั่ง "${cmd}" ถูกถอดออกแล้ว. ${LOCKED}`)
  if (has('set') || has('only')) die(`ไม่มี --set/--only. ${LOCKED}`)

  if (cmd === 'home' || cmd === 'scan') {
    if (json) { const r = await doScan(false); return out(JSON.stringify({ preset: preset().name, targets: r.targets, notFound: presetMissing(r.targets), warnings: r.warnings }, null, 1)) }
    banner(pkg.version)
    const r = await doScan(true), dk = await disk(), P = preset(), sel = new Set(r.targets.map(t => t.id))
    if (cmd === 'home' && live && !has('pick') && !has('no-pick')) {   // bare `destroyer` in a terminal: one screen, one Enter (tier A only; riskier things are yes/no questions)
      if (!r.targets.length) return void out(c.gr('✓ ไม่มีอะไรให้ล้างตาม preset แล้ว'))
      const chosen = await homeScreen(r.targets, dk)
      if (!chosen) return void out(c.dim('ออก — ไม่มีอะไรถูกลบ'))
      process.exitCode = await applyFlow(r.targets, chosen, { dryRun: false, yes: true, stop: true, quiet: true, label: P.name }); return   // yes = skip DESTROY only when the plan has no tier C (applyFlow enforces)
    }
    out(); out(`${c.b(`PRESET "${P.name}"`)} ${c.dim(`— ทำได้แค่นี้ (${P.allow.length} รูปแบบใน config/preset.toml) · พบในเครื่อง ${r.targets.length} รายการ`)}`)
    if (!r.targets.length) { out(c.gr('✓ ไม่มีอะไรให้ล้างตาม preset แล้ว')); return }
    printTargets(r.targets, sel); summary(P.name, r.targets, sel, [], dk)
    const gone = presetMissing(r.targets); if (gone.length) out(c.dim(`ไม่พบในเครื่อง (ล้างไปแล้ว/ไม่มี) ${gone.length} รูปแบบ — ดู: destroyer preset`))
    for (const w of r.warnings) out(c.am('! ') + c.dim(w))
    if (cmd === 'home' && live && !has('no-pick')) {          // bare `destroyer` in a terminal: untick what you want to keep → plan → DESTROY
      cacheNote(); out()
      const chosen = await pick(r.targets, sel, P.name, dk)
      if (!chosen || !chosen.size) return void out(c.dim('ออก — ไม่ได้เลือกอะไร ไม่มีอะไรถูกลบ'))
      process.exitCode = await applyFlow(r.targets, chosen, { dryRun: false, yes: false, stop: has('stop-daemons'), label: P.name }); return
    }
    cacheNote(); out(); return out(c.dim('ต่อไป:  destroyer (กด Enter ล้างเลย)  ·  destroyer --pick (เลือกเอง)  ·  destroyer apply --dry-run  ·  destroyer show <id>  ·  destroyer preset'))
  }
  if (cmd === 'apply') {
    const r = await doScan(false), skip = (flag('skip') ?? '').split(',').filter(Boolean).map(globRe)
    const ids = new Set(r.targets.filter(t => !skip.some(re => re.test(t.id))).map(t => t.id))
    if (skip.length) out(c.dim(`ข้าม ${r.targets.length - ids.size} รายการตาม --skip (เอาออกได้อย่างเดียว เพิ่มไม่ได้)`))
    process.exitCode = await applyFlow(r.targets, ids, { dryRun: has('dry-run'), yes: has('yes'), stop: has('stop-daemons'), label: preset().name }); return
  }
  if (cmd === 'preset') {
    const r = await doScan(false), P = preset(); out(rule(`PRESET "${P.name}" — ทำได้แค่นี้`))
    for (const g of P.allow) { const re = globRe(g), hit = r.targets.filter(t => re.test(t.id)); out(hit.length ? `${c.gr('✓')} ${g.padEnd(38)} ${String(hit.length).padStart(2)} รายการ ${fmt(sum(hit)).padStart(9)}` : `${c.dim('○ ' + g.padEnd(38) + ' ไม่พบในเครื่อง')}`) }
    return out(c.dim(`\nนอกจากนี้ลบไม่ได้ — ตัวลบ (exec.ts) ปฏิเสธทุก id ที่ไม่ตรงรายการนี้. แก้ขอบเขต: config/preset.toml`))
  }
  if (cmd === 'show') {
    const id = rest[0]; if (!id) die('ใช้: destroyer show <id>')
    const r = await doScan(false), t = r.targets.find(x => x.id === id)
    if (!t) { const near = r.targets.filter(x => x.id.includes(id)).slice(0, 5).map(x => x.id); die(`"${id}" ไม่อยู่ใน preset หรือไม่พบในเครื่อง${near.length ? ' — ใกล้เคียง: ' + near.join(', ') : ' (ดู destroyer scan)'}`) }
    return rail(t!.id, [...infoLines(t!, process.stdout.columns || 100), `${c.dim('module     ')}${t!.module}`, '', c.dim('show = อ่านอย่างเดียว')], tierC[t!.tier])
  }
  if (cmd === 'watch') { process.exitCode = await runWatch(rest[0] ?? 'status', { flag, has }); return }
  out(rule('destroyer — ล็อกเป็น preset เดียว'))
  for (const [a, b] of [['destroyer', 'หน้าเดียว: ล้างได้เลย (กด Enter) + ขอถามก่อน (ใช่/ไม่) → ลบ (ใน terminal)'], ['destroyer --pick', 'โหมดเลือกเอง: ติ๊ก/เอาออกทีละรายการ → แผน → พิมพ์ DESTROY'], ['scan [--json]', 'ดูอย่างเดียว — ไม่ลบ'], ['apply [--dry-run] [--yes] [--skip id,…]', 'ลบตาม preset แบบไม่ติ๊ก · --yes (ไม่มี tier C) · --stop-daemons'], ['show <id>', 'รายละเอียดของรายการใน preset'], ['preset', 'preset อนุญาตอะไรบ้าง และเจอในเครื่องกี่รายการ'], ['watch status|check|install|uninstall', 'เตือนก่อนดิสก์เต็ม (ไม่ลบเอง)']]) out(`  ${c.hi(a.padEnd(40))} ${c.dim(b)}`)
  out(c.dim('\n' + LOCKED))
}
main().then(() => process.exit(process.exitCode ?? 0), e => { out(c.rd('✗ ') + (e?.stack ?? e)); process.exit(1) })
