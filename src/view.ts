// shared printing helpers
import { $ } from 'bun'
import { fmt, short, type Target } from './core'
import { runningOwner } from './exec'
import { out, c, tierC, tierName, bar, rule, rail, bigNum, color, cols } from './ui'

export type Disk = { total: number; avail: number } | null
export const sum = (ts: Target[]) => ts.reduce((a, t) => a + t.bytes, 0)
export const fit = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, Math.max(0, n - 1)).join('') + '…' : s)
export async function disk(): Promise<Disk> {
  const l = (await $`df -k /System/Volumes/Data`.quiet().nothrow().text()).trim().split('\n')[1]?.split(/\s+/)
  return l ? { total: +l[1] * 1024, avail: +l[3] * 1024 } : null
}
export const meter = (u: number, w = 30) => { const n = Math.round(Math.max(0, Math.min(1, u)) * w), p = u > 0.9 ? c.rd : u > 0.8 ? c.am : c.gr; return p('█'.repeat(n)) + c.dim('░'.repeat(w - n)) }
export function printTargets(targets: Target[], sel?: Set<string>) {
  const max = Math.max(...targets.map(t => t.bytes), 1), idw = Math.min(56, Math.max(...targets.map(t => t.id.length), 10))
  for (const tier of ['A', 'B', 'C'] as const) {
    const g = targets.filter(t => t.tier === tier); if (!g.length) continue
    out(); out(rule(`${tier} ${tierName[tier]}`, tierC[tier], c.dim(`${fmt(sum(g))} · ${g.length} รายการ`)))
    for (const t of g) {
      const mark = sel ? (sel.has(t.id) ? c.gr('[x]') : c.dim('[ ]')) + ' ' : '', sudo = t.action.kind === 'sudo'
      const room = Math.max(24, cols() - (sel ? 4 : 0) - idw - 1 - 14 - 1 - 9 - 2 - 1)   // keep each row on one line
      const lab = fit(t.label, room), left = room - [...lab].length - (sudo ? 6 : 0), note = t.note && left > 10 ? fit(t.note, left - 4) : ''
      out(`${mark}${c.hi(t.id.padEnd(idw))} ${bar(t.bytes / max, 14, tierC[tier])} ${fmt(t.bytes).padStart(9)}  ${lab}${sudo ? c.am(' ⚠sudo') : ''}${note ? c.dim('  — ' + note) : ''}`)
    }
  }
}
export const describe = (t: Target) => { const a = t.action; return a.kind === 'rm' ? `${a.keepDir ? 'ลบข้างใน' : 'ลบ'} ${a.paths.map(short).join(', ')}` : a.kind === 'exec' ? a.argv.map(short).join(' ') : `${a.cmd}  (พิมพ์ให้ ไม่รันเอง)` }
// detail block for one target. values are cut to `width` BEFORE colouring so lines never wrap
export function infoLines(t: Target, width = 100): string[] {
  const vw = (k: string) => [...k].filter(ch => !/\p{Mn}/u.test(ch)).length   // Thai vowel/tone marks take no column
  const w = Math.max(30, width - 16), L = (k: string, v: string) => `${c.dim(k + ' '.repeat(Math.max(1, 12 - vw(k))))}${fit(v, w)}`
  const own = (t.owners ?? []).map(o => (runningOwner(o).length ? `${o} (รันอยู่ — เป้านี้จะถูกข้าม)` : `${o} (ไม่ได้รัน)`))
  return [`${tierC[t.tier](t.tier)} ${c.dim(tierName[t.tier])}  ${c.dim('·')}  ${c.b(fmt(t.bytes))}`, L('คืออะไร', t.label), L('ลบแล้ว', t.regen),
    ...t.paths.slice(0, 3).map(p => L('ที่อยู่', short(p))), ...(t.paths.length > 3 ? [c.dim(`${''.padEnd(11)}… และอีก ${t.paths.length - 3} ที่`)] : []),
    L('ถ้า apply', describe(t)), ...(own.length ? [L('ต้องปิดก่อน', own.join(', '))] : []), ...(t.note ? [L('หมายเหตุ', t.note)] : [])]
}
export function summary(name: string, targets: Target[], ids: Set<string>, missing: string[], dk: Disk) {
  const sel = targets.filter(t => ids.has(t.id)), total = sum(sel), sudoB = sum(sel.filter(t => t.action.kind === 'sudo')), exec = total - sudoB, nC = sel.filter(t => t.tier === 'C').length
  out()
  const L = [`${c.b(String(sel.length))} targets · ${fmt(total)} · tier C ${nC} ตัว ${c.dim('(อยู่ใน preset)')}`, '']
  if (color) L.push(...bigNum((exec / 1e9).toFixed(2)).map(l => '  ' + l), `${c.gr('GB')} ที่ลบได้จริง${sudoB ? c.dim(` · ขั้นที่ต้อง sudo ${fmt(sudoB)} จะพิมพ์ให้ ไม่รันเอง`) : ''}`)
  else L.push(`ลบได้จริง ${fmt(exec)}${sudoB ? ` (ขั้นที่ต้อง sudo ${fmt(sudoB)} จะพิมพ์ให้ ไม่รันเอง)` : ''}`)
  if (dk) { const after = dk.avail + exec; L.push('', `ว่างตอนนี้ ${fmt(dk.avail)} ${c.dim('→')} ${c.gr(c.b(fmt(after)))} ${c.dim(`(${(after / dk.total * 100).toFixed(1)}% ของ ${fmt(dk.total)})`)}`) }
  rail(`PRESET "${name}" — แผนถ้า apply (ยังไม่ลบอะไร)`, L)
}
