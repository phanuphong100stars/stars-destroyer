// apply: plan → gates → confirm (type DESTROY) → run → summary. Dry-run never touches anything.
import { fmt, short, clearCache, type Target } from './core'
import { applyTarget, runningOwner, stopOwner, stoppable, logLine, logFile, type Outcome } from './exec'
import { runScreen } from './tui'
import { printTargets, disk, sum, fit, describe } from './view'
import { out, c, live, rail, rule, word, color, gradient } from './ui'

const prio = (t: Target) => (t.action.kind === 'exec' && t.action.argv.includes('runtime') ? 2 : t.action.kind === 'sudo' ? 3 : 0) // devices before the runtime they live on; sudo last
const yes = (q: string) => (prompt(q) ?? '').trim().toLowerCase() === 'y'

async function runPlain(items: Target[], run: (t: Target) => Promise<Outcome>, stop: () => boolean) {
  const res: Outcome[] = []
  for (const t of items) {
    if (stop()) { out(c.am('หยุดตามคำสั่ง — ที่เหลือไม่ถูกแตะ')); break }
    const o = await run(t); res.push(o)
    out(`${o.status === 'done' ? c.gr('✓') : o.status === 'failed' ? c.rd('✗') : c.am('⚠')} ${t.id.padEnd(46)} ${o.status === 'done' ? fmt(o.bytes).padStart(9) : o.status.padStart(9)} ${c.dim(o.message ?? '')}`)
  }
  return res
}

export async function applyFlow(all: Target[], ids: Set<string>, o: { dryRun: boolean; yes: boolean; stop: boolean; label: string }): Promise<number> {
  const plan = all.filter(t => ids.has(t.id)).sort((a, b) => prio(a) - prio(b) || a.bytes - b.bytes)
  if (!plan.length) { out(c.am('ไม่มีรายการให้ลบ')); return 0 }
  const dk0 = await disk(), nC = plan.filter(t => t.tier === 'C').length, sudoB = sum(plan.filter(t => t.action.kind === 'sudo'))
  out(); out(rule('PLAN', c.dim, c.dim(o.dryRun ? 'dry-run — ไม่ลบอะไร' : `ชุด ${o.label}`)))
  printTargets(plan.slice().sort((a, b) => a.tier.localeCompare(b.tier) || b.bytes - a.bytes), new Set(plan.map(t => t.id)))
  out(); out(`  ${c.b('รวม ' + plan.length + ' targets')} · ${fmt(sum(plan))} · ลบได้จริง ${c.gr(c.b(fmt(sum(plan) - sudoB)))} · tier C ${nC} ตัว${sudoB ? c.dim(` · sudo ${fmt(sudoB)} จะพิมพ์ให้ ไม่รันเอง`) : ''}`)
  if (o.dryRun) { out(); for (const t of plan) { out(`  ${c.dim('would:')} ${c.hi(t.id)}`); out(`         ${c.dim(fit(describe(t), 120))}`) }; out(); out(`${c.gr('✓')} dry-run เสร็จ — ไม่มีอะไรถูกลบ`); return 0 }

  // ---- gates
  out(); out(rule('GATES'))
  out(`${c.gr('✓')} allowlist · ทุก path ผ่าน checkPath (${plan.length}/${plan.length}) · ไม่มี symlink/tier D ในแผน`)
  const owners = [...new Set(plan.flatMap(t => t.owners ?? []))], blocked = new Map<string, number[]>()
  for (const ow of owners) {
    let pids = runningOwner(ow); if (!pids.length) continue
    if (stoppable(ow) && (o.stop || (live && yes(`${c.am('?')} ${ow} กำลังรัน (pid ${pids.slice(0, 3).join(', ')}) — หยุดให้ไหม? [y/N] `)))) {
      await stopOwner(ow); pids = runningOwner(ow); if (!pids.length) { out(`${c.gr('✓')} หยุด ${ow} แล้ว`); continue }
    }
    blocked.set(ow, pids)
  }
  const isBlocked = (t: Target) => (t.owners ?? []).some(x => blocked.has(x)), skipped = plan.filter(isBlocked), runnable = plan.filter(t => !isBlocked(t))
  for (const [ow, pids] of blocked) out(`${c.am('‖')} ${ow} กำลังรัน (pid ${pids.slice(0, 3).join(', ')}) — ข้าม ${plan.filter(t => t.owners?.includes(ow)).length} เป้าที่ต้องรอ (ปิดแล้วรันใหม่ได้)`)
  if (!blocked.size) out(`${c.gr('✓')} ไม่มีแอปเจ้าของที่กำลังรัน`)
  if (!runnable.length) { out(c.am('ไม่มีอะไรลบได้ตอนนี้ — ทุกเป้าติดแอปที่กำลังรัน')); return 2 }
  out(`${c.gr('✓')} log · ${short(logFile())}`)

  // ---- confirm
  const hasC = runnable.some(t => t.tier === 'C'); out()
  if (!(o.yes && !hasC)) {
    if (!live) { out(c.am('! ต้องรันใน terminal เพื่อพิมพ์ DESTROY — หรือใส่ --yes (ใช้ได้เฉพาะแผนที่ไม่มี tier C)')); return 2 }
    if (prompt(`${c.am('?')} ลบ ${runnable.length} รายการ (${fmt(sum(runnable))}) — พิมพ์ ${c.b('DESTROY')} เพื่อลงมือ (Enter เปล่า = ยกเลิก) › `) !== 'DESTROY') { out(c.dim('ยกเลิก — ไม่มีอะไรถูกลบ')); return 0 }
  }

  // ---- run
  let stop = false; const sig = () => { stop = true }; process.on('SIGINT', sig)
  logLine({ event: 'session-start', set: o.label, targets: runnable.map(t => t.id) })
  const runner = async (t: Target) => { const r = await applyTarget(t); logLine({ event: 'target', tier: t.tier, module: t.module, ...r }); return r }
  const results = live ? await runScreen(runnable, runner, dk0, () => stop) : await runPlain(runnable, runner, () => stop)
  process.off('SIGINT', sig)

  // ---- summary
  const dk1 = await disk(), done = results.filter(r => r.status === 'done'), failed = results.filter(r => r.status === 'failed'), printed = results.filter(r => r.status === 'printed')
  const claimed = done.reduce((a, r) => a + r.bytes, 0), regens = [...new Set(done.map(r => runnable.find(t => t.id === r.id)!.regen))].slice(0, 4)
  logLine({ event: 'session-end', done: done.length, failed: failed.length, claimed }); if (done.length) clearCache()
  out()
  if (color && !failed.length && done.length) for (const l of word('DESTROYED')) out('  ' + gradient(l))
  const L = [`${c.gr('✓ ลบแล้ว ' + done.length)}${failed.length ? c.rd(' · ✗ ล้มเหลว ' + failed.length) : ''}${skipped.length ? c.am(' · ‖ ข้าม (แอปรัน) ' + skipped.length) : ''}${printed.length ? c.am(' · ⚠ sudo ' + printed.length) : ''}`,
    `คืนพื้นที่ (ตามขนาดที่สแกน) ${c.gr(c.b(fmt(claimed)))}${dk0 && dk1 ? ` · วัดจริงจาก df ${fmt(Math.max(0, dk1.avail - dk0.avail))} ${c.dim('(APFS อาจอัปเดตช้า)')}` : ''}`, dk1 ? `ว่างตอนนี้ ${c.b(fmt(dk1.avail))}` : '']
  for (const r of failed) L.push(`${c.rd('✗')} ${r.id}: ${r.message}`)
  for (const r of printed) L.push('', c.dim('ขั้นที่ต้อง sudo — ไม่ได้รันให้ (กติกา: ไม่รันเป็น root) คัดลอกไปรันเองได้:'), c.am(r.cmd ?? ''))
  if (regens.length) L.push('', c.dim('หลังจากนี้: ' + regens.join(' · ')))
  rail(failed.length ? 'เสร็จ (มีที่ล้มเหลว)' : 'DESTROYED', [...L, '', c.dim('log: ' + short(logFile()))], failed.length ? c.am : c.vi)
  return failed.length ? 1 : 0
}
