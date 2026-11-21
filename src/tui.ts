// full-screen pieces: the tick-box picker and the run screen (alt screen buffer; restored on exit).
import { fmt, type Target } from './core'
import { c, tierC, tierName, bar, rule, bigNum, gradient, shatter, SPIN } from './ui'
import { fit, meter, sum, infoLines, type Disk } from './view'
import type { Outcome } from './exec'

const ESC = '\x1b'
const rows = () => process.stdout.rows || 40
const enter = () => process.stdout.write(`${ESC}[?1049h${ESC}[?25l`)
const leave = () => process.stdout.write(`${ESC}[?25h${ESC}[?1049l`)
function frame(lines: string[]) {
  const h = rows(), buf = lines.slice(0, h).map(l => l + `${ESC}[K`)
  while (buf.length < h) buf.push(`${ESC}[K`)
  process.stdout.write(`${ESC}[H` + buf.join('\n'))
}

// ---------- picker ----------
export function pick(targets: Target[], initial: Set<string>, title: string, dk: Disk): Promise<Set<string> | null> {
  return new Promise(resolve => {
    const sel = new Set(initial); let cur = 0, top = 0, info = false
    const idw = Math.min(46, Math.max(...targets.map(t => t.id.length), 10)), max = Math.max(...targets.map(t => t.bytes), 1)
    const flat: ({ h: 'A' | 'B' | 'C' } | { t: Target })[] = []
    for (const tier of ['A', 'B', 'C'] as const) { const g = targets.filter(t => t.tier === tier); if (!g.length) continue; flat.push({ h: tier }); g.forEach(t => flat.push({ t })) }
    const idx = flat.map((r, i) => ('t' in r ? i : -1)).filter(i => i >= 0)
    const draw = () => {
      const at = idx[cur], infoL = info ? infoLines((flat[at] as { t: Target }).t, process.stdout.columns || 100) : []
      const vh = Math.max(4, rows() - 7 - (infoL.length ? infoL.length + 1 : 0))
      if (at < top) top = Math.max(0, at - (flat[at - 1] && 'h' in flat[at - 1] ? 1 : 0))
      if (at >= top + vh) top = at - vh + 1
      const L = [`  ${c.b(gradient('DESTROYER'))} ${c.dim('· เลือกสิ่งที่จะลบ · ชุด')} ${c.b(title)}`, '  ' + c.dim('[↑↓] เลื่อน  [space] เลือก  [i] ดูข้างใน  [a] tier A  [n] ไม่เลือก  [s] กลับชุดเริ่มต้น  [enter] ไปต่อ  [q] ออก'), '']
      for (let i = top; i < Math.min(flat.length, top + vh); i++) {
        const r = flat[i]
        if ('h' in r) { L.push('  ' + rule(`${r.h} ${tierName[r.h]}`, tierC[r.h])); continue }
        const t = r.t, on = i === at, room = Math.max(16, (process.stdout.columns || 100) - idw - 14 - 9 - 13)
        L.push(`${on ? c.rd('❯') : ' '} ${sel.has(t.id) ? c.gr('[x]') : c.dim('[ ]')} ${(on ? c.b : c.hi)(fit(t.id, idw).padEnd(idw))} ${bar(t.bytes / max, 12, tierC[t.tier])} ${fmt(t.bytes).padStart(9)}  ${fit(t.label, room)}${t.action.kind === 'sudo' ? c.am(' ⚠sudo') : ''}`)
      }
      while (L.length < vh + 3) L.push('')
      if (infoL.length) { L.push('  ' + rule('รายละเอียด', c.vi)); for (const l of infoL) L.push('  ' + l) }
      const chosen = targets.filter(t => sel.has(t.id)), tot = sum(chosen), exec = tot - sum(chosen.filter(t => t.action.kind === 'sudo')), nC = chosen.filter(t => t.tier === 'C').length
      L.push('  ' + c.dim('─'.repeat(40)), `  เลือก ${c.b(String(chosen.length))} · ${fmt(tot)} · ลบได้จริง ${c.gr(c.b(fmt(exec)))}${nC ? c.or(` · tier C ${nC}`) : ''}`)
      if (dk) L.push(`  ว่าง ${fmt(dk.avail)} ${c.dim('→')} ${c.gr(c.b(fmt(dk.avail + exec)))}`)
      frame(L)
    }
    const done = (v: Set<string> | null) => { process.stdin.off('data', onKey); process.stdout.off('resize', draw); process.stdin.setRawMode(false); process.stdin.pause(); leave(); resolve(v) }
    const onKey = (b: Buffer) => {
      const k = b.toString()
      if (k === '\x03' || k === 'q' || k === '\x1b') return done(null)
      if (k === '\r' || k === '\n') return done(new Set(sel))
      if (k === '\x1b[A' || k === 'k') cur = Math.max(0, cur - 1)
      else if (k === '\x1b[B' || k === 'j') cur = Math.min(idx.length - 1, cur + 1)
      else if (k === ' ') { const t = (flat[idx[cur]] as { t: Target }).t; sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id) }
      else if (k === 'a') { const A = targets.filter(t => t.tier === 'A'), all = A.every(t => sel.has(t.id)); A.forEach(t => (all ? sel.delete(t.id) : sel.add(t.id))) }
      else if (k === 'i' || k === '?') info = !info
      else if (k === 'n') sel.clear()
      else if (k === 's') { sel.clear(); initial.forEach(i => sel.add(i)) }
      draw()
    }
    process.stdin.setRawMode(true); process.stdin.resume(); enter(); draw(); process.stdin.on('data', onKey); process.stdout.on('resize', draw)
  })
}

// ---------- run screen ----------
export async function runScreen(items: Target[], run: (t: Target) => Promise<Outcome>, dk: Disk, shouldStop: () => boolean): Promise<Outcome[]> {
  type St = { t: Target; s: 'queued' | 'run' | Outcome['status']; p: number; th: number[]; ms?: number }
  const st: St[] = items.map(t => ({ t, s: 'queued', p: 0, th: Array.from({ length: 18 }, (_, i) => (i / 18) * 0.7 + Math.random() * 0.2) }))
  const total = sum(items), idw = Math.min(40, Math.max(...items.map(t => t.id.length), 10)), SPK = '▁▂▃▄▅▆▇█'
  const logs: string[] = [], samples: number[] = dk ? [dk.avail] : [], t0 = performance.now(), outcomes: Outcome[] = []
  let freed = 0, shown = 0, n = 0, cur = 0
  const clock = () => { const s = Math.floor((performance.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
  const lg = (s: string) => { logs.push(`${c.dim('[' + clock() + ']')} ${s}`); if (logs.length > 40) logs.shift() }
  const row = (x: St) => {
    const t = x.t, s = x.s
    const ic = s === 'queued' ? c.dim('○') : s === 'run' ? c.rd(SPIN[n % 10]) : s === 'done' ? c.gr('✓') : s === 'failed' ? c.rd('✗') : s === 'blocked' ? c.am('‖') : s === 'printed' ? c.am('⚠') : c.dim('–')
    const b = s === 'queued' ? tierC[t.tier]('█'.repeat(18)) : s === 'run' ? shatter(x.th, x.p, tierC[t.tier]) : s === 'done' ? c.dim('· · · gone · · ·'.padEnd(18)) : s === 'failed' ? c.rd('x failed'.padEnd(18)) : s === 'blocked' ? c.am('waiting for owner'.padEnd(18)) : s === 'printed' ? c.am('▒▒ needs sudo ▒▒'.padEnd(18)) : c.dim('— gone —'.padEnd(18))
    const stat = s === 'run' ? `${Math.round(x.p * 100)}%` : s === 'done' ? `${x.ms}ms` : s === 'queued' ? 'queued' : s === 'failed' ? 'FAILED' : s === 'printed' ? 'sudo' : s === 'blocked' ? 'blocked' : 'gone'
    return `  ${ic} ${(s === 'done' ? c.dim : c.hi)(fit(t.id, idw).padEnd(idw))} ${b} ${fmt(t.bytes).padStart(9)} ${c.dim(stat)}`
  }
  const render = () => {
    n++; shown += (freed - shown) * 0.25; if (Math.abs(freed - shown) < 2e6) shown = freed
    for (const x of st) if (x.s === 'run') x.p += (0.92 - x.p) * 0.07
    const avail = dk ? dk.avail + shown : 0
    if (n % 3 === 0 && dk) samples.push(avail)
    const L = [`  ${c.b(gradient('DESTROYER'))} ${c.dim(`· apply · ${items.length} targets · ${fmt(total)}`)}   ${c.dim(clock())}`, '', ...bigNum((shown / 1e9).toFixed(2)).map(r => '  ' + r),
      `  ${c.gr('GB')} ${c.dim('freed ·')} ${st.filter(x => x.s !== 'queued' && x.s !== 'run').length}/${st.length} ${c.dim('เสร็จ')}`]
    if (dk) { const lo = dk.avail, hi = dk.avail + total || 1, spark = samples.slice(-30).map(v => SPK[Math.min(7, Math.max(0, Math.round(((v - lo) / (hi - lo || 1)) * 7)))]).join(''); L.push(`  ${c.dim('DISK')} ${meter(1 - avail / dk.total, 30)} ${c.b('ว่าง ' + fmt(avail))} ${c.dim(`(${((avail / dk.total) * 100).toFixed(1)}%)`)}  ${c.gr(spark)}`) } else L.push('')
    L.push('')
    const vh = Math.max(5, rows() - (L.length + 8)), first = Math.max(0, Math.min(Math.max(0, st.length - vh), cur - Math.floor(vh / 2)))
    L.push(`  ${c.dim('TARGETS')}`); for (const x of st.slice(first, first + vh)) L.push(row(x))
    L.push(''); for (const l of logs.slice(-5)) L.push('  ' + l)
    frame(L)
  }
  enter(); const timer = setInterval(render, 80)
  try {
    for (let i = 0; i < st.length; i++) {
      if (shouldStop()) { lg(c.am('หยุดตามคำสั่ง — ที่เหลือไม่ถูกแตะ')); break }
      const x = st[i]; cur = i; x.s = 'run'; lg(`${c.rd('▶')} ${x.t.id}`)
      const t1 = performance.now(), o = await run(x.t), el = performance.now() - t1
      if (el < 350) await Bun.sleep(350 - el)   // let the bar visibly shatter even when the delete was instant
      x.s = o.status; x.p = 1; x.ms = o.ms; outcomes.push(o)
      if (o.status === 'done') { freed += o.bytes; lg(`${c.gr('✓')} ${fmt(o.bytes)} freed ${c.dim('· ' + x.t.id)}`) }
      else if (o.status === 'failed') lg(`${c.rd('✗')} ${x.t.id} ${c.rd(fit(o.message ?? '', 70))}`)
      else if (o.status === 'printed') lg(`${c.am('⚠')} needs sudo → printed at the end`)
      else lg(`${c.dim('–')} ${x.t.id} ${c.dim(o.message ?? o.status)}`)
    }
    cur = st.length - 1; await Bun.sleep(300); render(); await Bun.sleep(1100)
  } finally { clearInterval(timer); leave() }
  return outcomes
}
