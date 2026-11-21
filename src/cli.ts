#!/usr/bin/env bun
// destroyer — ตัวล้างพื้นที่สำหรับ mobile dev. สแกน/ดู/เพิ่ม = อ่านอย่างเดียว · apply = dry-run ก่อน → พิมพ์ DESTROY → ลบ
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, expand, short, fmt, slug, checkPath, globRe, makeCtx, load, scan, loadSets, resolveSet, validateTarget, renderTargetToml, saveSet, setDefault, cacheStats, saveCache, type Target, type Mod } from './core'
import { out, c, tierC, tierName, banner, bar, rule, rail, Live, SPIN, live } from './ui'
import { discover, tierGuess } from './discover'
import { sum, fit, disk, meter, printTargets, summary } from './view'
import { pick } from './tui'
import { applyFlow } from './apply'
import pkg from '../package.json'

const args = process.argv.slice(2)
const first = args[0] && !args[0].startsWith('--') ? args[0] : undefined
const cmd = first ?? (args.length ? 'scan' : 'home'), rest = first ? args.slice(1) : args
const flag = (n: string) => { const i = rest.indexOf('--' + n); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined }
const has = (n: string) => rest.includes('--' + n), json = has('json')
const die = (m: string): never => { out(c.rd('✗ ') + m); process.exit(1) }

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
const footer = () => { cacheNote(); out(); out(c.dim('ต่อไป:  destroyer (เลือก+ลบ)  ·  destroyer show <id>  ·  destroyer discover  ·  destroyer add <โฟลเดอร์>  ·  destroyer apply --set sweep --dry-run')) }

// which targets does --set / --only select? (C only ever via explicit ids)
function selectIds(targets: Target[], sets: ReturnType<typeof loadSets>) {
  const setNames = (flag('set') ?? '').split(',').filter(Boolean), only = flag('only')
  if (!setNames.length && !only) die('ระบุ --set <ชุด> หรือ --only id,id (ใช้ * ได้) — ตัวอย่าง: destroyer apply --set safe --dry-run')
  const ids = new Set<string>(), missing: string[] = [], label = [...setNames, ...(only ? ['--only'] : [])].join('+')
  for (const n of setNames) { try { const r = resolveSet(n, sets.sets, targets); r.ids.forEach(i => ids.add(i)); missing.push(...r.missing) } catch (e: any) { die(e.message) } }
  for (const pat of (only ?? '').split(',').filter(Boolean)) { const re = globRe(pat), hit = targets.filter(t => re.test(t.id)); if (!hit.length) missing.push(pat); hit.forEach(t => ids.add(t.id)) }
  return { ids, label, missing }
}

async function main() {
  if (cmd === 'home' || cmd === 'scan') {
    if (json) { const r = await doScan(false); return out(JSON.stringify({ targets: r.targets, counts: r.counts, warnings: r.warnings }, null, 1)) }
    banner(pkg.version)
    const r = await doScan(true), sets = loadSets(), setName = flag('set') ?? (cmd === 'home' ? sets.default : undefined), dk = await disk()
    if (dk) { const u = 1 - dk.avail / dk.total; out(); out(`${c.dim('Mac ')} ${meter(u)}  ${c.b('ว่าง ' + fmt(dk.avail))} ${c.dim(`(${(dk.avail / dk.total * 100).toFixed(1)}%) จาก ${fmt(dk.total)}`)}`) }
    let sel: Set<string> | undefined, missing: string[] = []
    if (setName) { try { const x = resolveSet(setName, sets.sets, r.targets); sel = x.ids; missing = x.missing } catch (e: any) { die(e.message) } }
    printTargets(r.targets, sel)
    if (setName && sel) summary(setName, r.targets, sel, missing, dk)
    for (const w of r.warnings) out(c.am('! ') + c.dim(w))
    if (cmd === 'home' && live && !has('no-pick')) {          // bare `destroyer` in a terminal = scan → tick-box picker → plan → DESTROY
      cacheNote(); out()
      const chosen = await pick(r.targets, sel ?? new Set(), setName ?? 'ไม่มี', dk)
      if (!chosen || !chosen.size) return void out(c.dim('ออก — ไม่ได้เลือกอะไร ไม่มีอะไรถูกลบ'))
      process.exitCode = await applyFlow(r.targets, chosen, { dryRun: false, yes: false, stop: has('stop-daemons'), label: 'ที่เลือก' }); return
    }
    return footer()
  }
  if (cmd === 'apply') {
    const r = await doScan(false), sel = selectIds(r.targets, loadSets())
    if (sel.missing.length) out(c.am('! รูปแบบที่ไม่เจอเป้า: ') + c.dim(sel.missing.join(', ')))
    process.exitCode = await applyFlow(r.targets, sel.ids, { dryRun: has('dry-run'), yes: has('yes'), stop: has('stop-daemons'), label: sel.label }); return
  }
  if (cmd === 'modules') {
    const mods = await load(makeCtx()); out(rule('MODULES'))
    for (const l of mods) out(`${l.status === 'loaded' ? c.gr('✓') : c.dim('○')} ${l.mod.id.padEnd(16)} ${c.dim((l.mod.kind ?? 'cleaner').padEnd(9) + ' ' + l.source.padEnd(9))} ${c.dim(l.why ?? '')}`)
    return
  }
  if (cmd === 'show') {
    const id = rest[0]; if (!id) die('ใช้: destroyer show <id>')
    const r = await doScan(false), t = r.targets.find(x => x.id === id)
    if (!t) { const near = r.targets.filter(x => x.id.includes(id)).slice(0, 5).map(x => x.id); die(`ไม่เจอ "${id}"${near.length ? ' — ใกล้เคียง: ' + near.join(', ') : ' (ลอง destroyer scan ดู id)'}`) }
    const a = t!.action, how = a.kind === 'rm' ? `${a.keepDir ? 'ลบ "ข้างใน" เก็บโฟลเดอร์' : 'ลบทั้งโฟลเดอร์'}: ${a.paths.map(short).join(', ')}` : a.kind === 'exec' ? `รันเครื่องมือเจ้าของ: ${a.argv.map(x => short(x)).join(' ')}` : `พิมพ์ให้คุณรันเอง: ${a.cmd}`
    rail(t!.id, [`${tierC[t!.tier](t!.tier)} ${c.dim(tierName[t!.tier])}`, `${c.dim('คืออะไร  ')}${t!.label}`, `${c.dim('ขนาด     ')}${c.b(fmt(t!.bytes))}`, `${c.dim('ลบแล้ว   ')}${t!.regen}`,
      ...t!.paths.map(p => `${c.dim('ที่อยู่    ')}${short(p)}`), `${c.dim('ถ้า apply ')}${how}`, ...(t!.owners?.length ? [`${c.dim('ต้องปิดก่อน')} ${t!.owners.join(', ')}`] : []), ...(t!.note ? [`${c.dim('หมายเหตุ  ')}${t!.note}`] : []), `${c.dim('module    ')}${t!.module}`, '', c.dim('show = อ่านอย่างเดียว — ลบจริงด้วย destroyer apply --only ' + t!.id)], tierC[t!.tier])
    return
  }
  if (cmd === 'set') {
    const sets = loadSets(), sub = rest[0] ?? 'list'
    if (sub === 'default') { const n = rest[1]; if (!n || !sets.sets[n]) die('ใช้: destroyer set default <ชื่อชุดที่มีอยู่>'); setDefault(n!); return void out(`${c.gr('✓')} ชุดเริ่มต้น = ${c.b(n!)} ${c.dim('(ตอนพิมพ์แค่ destroyer)')}`) }
    if (sub === 'save') {
      const n = rest[1], only = flag('only'); if (!n || n.startsWith('--') || !only) die('ใช้: destroyer set save <ชื่อ> --only id,id,…  (ใช้ * ได้)')
      const r = await doScan(false), pats = only!.split(','); const miss = pats.filter(p => !r.targets.some(t => globRe(p).test(t.id)))
      if (miss.length) die(`ไม่เจอเป้าตามรูปแบบ: ${miss.join(', ')}`)
      try { saveSet(n!, pats) } catch (e: any) { die(e.message) }
      return void out(`${c.gr('✓')} บันทึกชุด ${c.b(n!)} · ${r.targets.filter(t => pats.some(p => globRe(p).test(t.id))).length} targets ${c.dim('→ ~/.config/destroyer/sets.toml · destroyer apply --set ' + n)}`)
    }
    const r = await doScan(false)
    if (sub === 'list') { out(rule('SETS')); for (const n of Object.keys(sets.sets)) { try { const x = resolveSet(n, sets.sets, r.targets), ts = r.targets.filter(t => x.ids.has(t.id)); out(`${n === sets.default ? c.gr('★') : ' '} ${c.hi(n.padEnd(16))} ${String(ts.length).padStart(3)} targets ${fmt(sum(ts)).padStart(9)}  ${x.missing.length ? c.am('! ' + x.missing.length + ' pattern ไม่เจอเป้า') : ''}`) } catch (e: any) { out(`  ${n.padEnd(16)} ${c.rd(e.message)}`) } } return void out(c.dim('★ = ชุดเริ่มต้นตอนพิมพ์แค่ destroyer')) }
    if (sub === 'show') { const n = rest[1]; if (!n || !sets.sets[n]) die('ใช้: destroyer set show <ชื่อชุด>'); const x = resolveSet(n!, sets.sets, r.targets); printTargets(r.targets.filter(t => x.ids.has(t.id))); return summary(n!, r.targets, x.ids, x.missing, await disk()) }
    return die('ใช้: destroyer set list | show <ชื่อ> | save <ชื่อ> --only … | default <ชื่อ>')
  }
  if (cmd === 'discover') {
    const t0 = performance.now(); banner(pkg.version)
    const base = await doScan(false), min = +(flag('min') ?? 200)
    const res = await discover(base.ctx, base.targets, min, (d, t, f) => { if (live && d % 3 === 0) process.stdout.write(`\r\x1b[2K${c.vi(SPIN[d % 10])} กำลังหา… ${d}/${t} ${c.dim('· เจอ ' + f)}`) })
    if (live) process.stdout.write('\r\x1b[2K')
    if (json) return out(JSON.stringify(res.rows, null, 1))
    out(rule('DISCOVER', c.dim, c.dim(`≥ ${min} MB · ข้าม ${res.skipped} ที่ที่ module ดูแลอยู่/ไม่ต้องดู · ${((performance.now() - t0) / 1000).toFixed(1)}s`)))
    const max = res.rows[0]?.bytes ?? 1
    res.rows.forEach((r, i) => out(`${c.dim(String(i + 1).padStart(2))}  ${bar(r.bytes / max, 14, tierC[r.tier])} ${fmt(r.bytes).padStart(9)}  ${r.path.padEnd(58)} ${tierC[r.tier](r.tier)} ${c.dim('แก้ล่าสุด ' + r.ageDays + ' วันก่อน')}`))
    saveCache(); cacheNote()
    return out(c.dim('\nเพิ่มเข้ารายการ (ไม่ต้องเขียนโค้ด):  destroyer add "<โฟลเดอร์>"      ← tier ในคอลัมน์คือค่าที่แนะนำ'))
  }
  if (cmd === 'add') {
    const raw = rest[0]; if (!raw || raw.startsWith('--')) die('ใช้: destroyer add <โฟลเดอร์> [--tier A|B|C] [--regen "…"] [--owner "แอป"]')
    const abs = expand(raw!); if (!existsSync(abs)) die(`ไม่เจอ ${raw}`)
    const bad = checkPath(abs); if (bad) die(`ไม่ปลอดภัย: ${bad}`)
    const parts = abs.split('/'), id = flag('id') ?? slug(`${parts.at(-2)}-${parts.at(-1)}`)
    let tier = (flag('tier') ?? tierGuess(abs)).toUpperCase(), owner = flag('owner') ?? ({ Code: 'Visual Studio Code', BraveSoftware: 'Brave Browser' } as Record<string, string>)[/Application Support\/([^/]+)/.exec(abs)?.[1] ?? ''] ?? /Application Support\/([^/]+)/.exec(abs)?.[1]
    if (process.stdout.isTTY && !flag('tier') && !has('yes')) {
      const a = prompt(`ลบแล้วเกิดอะไร? A=สร้างใหม่เอง  B=โหลด/ติดตั้งใหม่  C=ไม่แน่ใจ [${tier}]`); if (a && 'ABC'.includes(a.toUpperCase())) tier = a.toUpperCase()
      const o = prompt(`ต้องปิดแอปไหนก่อนลบ? [${owner ?? 'ไม่ต้อง'}]`); if (o) owner = o
    }
    if (!['A', 'B', 'C'].includes(tier)) die(`tier "${tier}" ใช้ไม่ได้ — A/B/C เท่านั้น`)
    const regen = flag('regen') ?? (tier === 'C' ? 'ไม่แน่ใจ — ตัดสินเองทุกครั้ง' : tier === 'B' ? 'โหลด/สร้างใหม่ได้ ใช้เวลา' : 'สร้างใหม่เอง')
    mkdirSync(CONFIG, { recursive: true })
    appendFileSync(join(CONFIG, 'targets.toml'), renderTargetToml({ id, label: flag('label') ?? `${parts.at(-2)} · ${parts.at(-1)}`, path: short(abs), tier, regen, owners: owner ? [owner] : undefined }))
    out(`${c.gr('✓')} เพิ่ม ${c.b(id)} (${fmt(await makeCtx().du(abs))}) · tier ${tierC[tier as 'A' | 'B' | 'C'](tier)}${owner ? ' · ต้องปิด: ' + owner : ''}`)
    return out(c.dim(`  → ${short(join(CONFIG, 'targets.toml'))} · โผล่ใน destroyer ทันที ไม่ต้อง build/ลงทะเบียน`))
  }
  if (cmd === 'new') {
    const id = rest[0] ?? 'my-module', dir = join(CONFIG, 'modules'), file = join(dir, `${id}.ts`)
    if (existsSync(file)) die(`มีไฟล์ ${short(file)} อยู่แล้ว`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `// destroyer module: ${id} — แก้ 3 จุดที่ TODO แล้วรัน: destroyer check ${id}.ts
export default {
  id: '${id}',
  detect: ({ has }) => has('${id}'),            // TODO: เครื่องมือที่ต้องมี (ไม่มี = ข้ามเงียบๆ)
  async scan({ du }) {
    const p = '/path/to/folder'                  // TODO: โฟลเดอร์ที่จะลบ (ต้องลึกพอ — check จะบอกถ้ากว้างเกินไป)
    return [{ id: '${id}:main', label: '${id}', bytes: await du(p), tier: 'B', regen: 'TODO: ลบแล้วเกิดอะไร / สร้างใหม่ยังไง',
      paths: [p], action: { kind: 'rm', paths: [p] } }]
  },
}
`)
    out(`${c.gr('✓')} สร้าง ${short(file)}`); return out(c.dim(`  แก้ 3 จุด TODO แล้วรัน: destroyer check ${id}.ts`))
  }
  if (cmd === 'check') {
    const arg = rest[0]; if (!arg) die('ใช้: destroyer check <ไฟล์.ts>')
    const file = arg!.includes('/') ? expand(arg!) : join(CONFIG, 'modules', arg!)
    if (!existsSync(file)) die(`ไม่เจอไฟล์ ${short(file)}`)
    const t0 = performance.now(); let bad = 0
    try {
      const mod: Mod = (await import(file)).default, ctx = makeCtx()
      if (!mod || typeof mod.id !== 'string') throw new Error('ต้อง export default { id: "…" }')
      if (mod.detect && !(await mod.detect(ctx))) out(`${c.dim('○')} ${mod.id} · detect() = false → จะถูกข้ามบนเครื่องนี้ ${c.dim('(ปกติ ถ้าเครื่องมือยังไม่ได้ติดตั้ง)')}`)
      else if (mod.scan) {
        const ts = await mod.scan(ctx)
        for (const t of ts) { const e = validateTarget(t); if (e.length) { bad++; e.forEach(x => out(`${c.rd('✗')} ${x}`)) } else if (!t.regen) out(`${c.am('!')} target "${t.id}": ยังไม่ใส่ regen (บอกผู้ใช้ว่าลบแล้วเกิดอะไร)`) }
        if (!bad) { out(`${c.gr('✓')} ${mod.id} · detect ผ่าน · scan() ได้ ${ts.length} target · ${fmt(sum(ts))} · ${Math.round(performance.now() - t0)}ms`); for (const t of ts) out(`  ${tierC[t.tier](t.tier)}  ${t.id.padEnd(30)} ${fmt(t.bytes).padStart(9)}  ${t.label}`) }
      } else out(`${c.gr('✓')} ${mod.id} · โหลดได้ ${c.dim('(ไม่มี scan — เป็น reporter?)')}`)
    } catch (e: any) { bad++; out(`${c.rd('✗')} โหลด/รัน module ไม่ได้: ${e?.message ?? e}`) }
    if (bad) process.exit(1); return
  }
  out(rule('destroyer'))
  for (const [a, b] of [['destroyer', 'สแกน → ติ๊กเลือก → แผน → พิมพ์ DESTROY → ลบ (ใน terminal)'], ['scan [--set ชุด] [--json]', 'สแกนเป็นตาราง (อ่านอย่างเดียว)'], ['apply --set ชุด | --only id,…', 'ลบแบบไม่ติ๊ก · เพิ่ม --dry-run เพื่อดูแผนเฉยๆ · --yes (ไม่มี tier C) · --stop-daemons'], ['show <id>', 'ดูรายละเอียดและสิ่งที่ apply จะทำ'], ['discover [--min MB]', 'หาโฟลเดอร์ใหญ่ที่ยังไม่มีใครดูแล'], ['add <โฟลเดอร์>', 'เพิ่มเองบรรทัดเดียว (ไม่ต้องเขียนโค้ด)'], ['new <ชื่อ> · check <ไฟล์>', 'สร้าง/ตรวจ module แบบมีโค้ด'], ['modules · set list|show|save|default', 'ดู module / จัดการชุดสำเร็จรูป']]) out(`  ${c.hi(a.padEnd(34))} ${c.dim(b)}`)
}
main().then(() => process.exit(process.exitCode ?? 0), e => { out(c.rd('✗ ') + (e?.stack ?? e)); process.exit(1) })
