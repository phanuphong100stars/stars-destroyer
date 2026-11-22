// home: the one-screen start page. Software decides what is safe ("ล้างได้เลย"); everything riskier becomes a yes/no question whose default is "keep".
import { fmt, short, type Target } from './core'
import { c, rule, gradient } from './ui'
import { fit, meter, sum, type Disk } from './view'
import { enter, leave, frame } from './tui'
import { classify, GROUP, type Plan } from './plan'

const vw = (s: string) => [...s].filter(ch => !/\p{Mn}/u.test(ch)).length   // Thai vowel/tone marks take no column
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(1, n - vw(s)))
export type HomeOpts = { details: boolean; msg: string; cols: number }

export function homeView(plan: Plan, yes: Set<string>, dk: Disk, o: HomeOpts): { body: string[]; foot: string[] } {
  const w = Math.max(40, o.cols - 4), L: string[] = [], asks = plan.ask.slice(0, 9)
  const picked = asks.filter(q => yes.has(q.key)), autoB = sum(plan.auto), total = autoB + sum(picked.flatMap(q => q.targets)), gate = picked.some(q => q.tier === 'C')
  L.push(`  ${c.b(gradient('HELLBRINGER'))} ${c.dim('› DESTROYER · ล้างเฉพาะของที่สร้างใหม่ได้')}`)
  if (dk) L.push(`  ${c.dim('ที่ว่างตอนนี้')} ${meter(1 - dk.avail / dk.total, 20)} ${c.b(fmt(dk.avail))} ${c.dim(`(${((dk.avail / dk.total) * 100).toFixed(1)}%)`)}${dk.avail / dk.total < 0.1 ? c.am(' เหลือน้อย') : ''}`)
  L.push('')

  if (!plan.auto.length && !asks.length) {   // nothing to do: say why, in one screen
    if (plan.skip.length) L.push(`  ${c.am('‖')} ${c.b('ตอนนี้ล้างไม่ได้')} ${c.dim('— แอปเหล่านี้ยังเปิดอยู่')}`, ...[...new Set(plan.skip.map(s => s.owner))].map(x => '    ' + x), '', '  ' + c.dim('ปิดแอปแล้วรัน hellbringer ใหม่ · ยังไม่มีอะไรถูกลบ'))
    else L.push(`  ${c.gr('✓')} ${c.b('เครื่องสะอาดแล้ว')} ${c.dim('— ไม่มีอะไรให้ล้างตอนนี้')}`)
    return { body: L, foot: ['  ' + c.dim('[q] ออก')] }
  }

  L.push('  ' + rule('ล้างได้เลย', c.gr, c.dim('[enter]')))
  if (plan.auto.length) {
    L.push(`  ${c.gr(c.b(fmt(autoB)))} ${c.dim('สร้างใหม่เองทั้งหมด · ไม่แตะโค้ดหรือไฟล์งาน')}`)
    const groups = new Map<string, Target[]>(); for (const t of plan.auto) { const m = t.module ?? '?'; groups.set(m, [...(groups.get(m) ?? []), t]) }
    for (const [m, ts] of [...groups].sort((a, b) => sum(b[1]) - sum(a[1]))) {
      const name = GROUP[m] ?? m, room = Math.max(10, w - 48)
      L.push(`  ${pad(name, 34)} ${fmt(sum(ts)).padStart(9)}  ${c.dim(fit([...new Set(ts.map(t => t.regen))][0], room))}`)
      if (o.details) for (const t of ts) L.push(c.dim(`      ${t.id}  ${fmt(t.bytes)}  ${fit(short(t.paths[0] ?? ''), w - 40)}`))
    }
  } else L.push('  ' + c.dim('ไม่มีอะไรให้ล้างอัตโนมัติ'))
  for (const s of plan.stops) L.push(`  ${c.am('◐')} หยุด ${s} ให้เอง ${c.dim('— เปิดกลับมาเองตอนใช้งานครั้งหน้า')}`)
  for (const { t, owner } of plan.skip) L.push(`  ${c.am('‖')} ข้าม ${t.label} ${c.dim(`— ${owner} เปิดอยู่ ปิดแล้วรันใหม่ได้`)}`)
  if (plan.sudo.length) L.push(`  ${c.am('⚠')} อีก ${fmt(sum(plan.sudo))} ต้องใช้รหัสผ่านเครื่อง ${c.dim('— ให้คำสั่งตอนจบ (คัดลอกให้อัตโนมัติ)')}`)

  if (asks.length) {
    L.push('', '  ' + rule(`ขอถามก่อน ${asks.length} ข้อ`, c.am, c.dim('ค่าเริ่มต้น = เก็บไว้')))
    asks.forEach((q, i) => {
      const on = yes.has(q.key)
      L.push(`  ${on ? c.gr('[x]') : c.dim('[ ]')} ${c.dim(String(i + 1))} ${c.hi(q.title)} ${on ? c.gr('ลบ') : c.dim('เก็บไว้')} ${q.tier === 'C' ? c.or('เอากลับยาก') : c.am('โหลดใหม่')}  ${c.b(fmt(q.bytes))}`, '        ' + c.dim(fit(q.why, w - 8)))
    })
    if (plan.ask.length > asks.length) L.push('  ' + c.dim(`… และอีก ${plan.ask.length - asks.length} ข้อ — ใช้ hellbringer --pick เลือกเอง`))
  }

  const can = plan.auto.length > 0 || picked.length > 0
  const btn = !can ? c.dim('[enter] ยังไม่มีอะไรให้ล้าง') : gate ? c.or(c.b(`[enter] ไปยืนยัน ${fmt(total)}`)) : c.gr(c.b(`[enter] ล้างเลย ${fmt(total)}`))
  const foot = ['  ' + c.dim('─'.repeat(40)), `  ${btn}${dk && can ? c.dim('   ว่าง ') + fmt(dk.avail) + c.dim(' → ') + c.gr(c.b(fmt(dk.avail + total))) : ''}`,
    '  ' + c.dim(`${asks.length ? `1-${asks.length} สลับคำตอบ · ` : ''}d ${o.details ? 'ซ่อน' : 'ดู'}ละเอียด · q ออก (ไม่ลบอะไร)`)]
  if (o.msg) foot.push('  ' + c.am(o.msg))
  return { body: L, foot }
}

// full-screen loop. resolves with the target ids to apply (auto + the "yes" answers + sudo/skip so apply can print/report them), or null = quit
export function homeScreen(targets: Target[], dk: Disk): Promise<Set<string> | null> {
  const plan = classify(targets)
  return new Promise(resolve => {
    const yes = new Set<string>(); let details = false, msg = ''
    const draw = () => {
      const h = process.stdout.rows || 40, { body, foot } = homeView(plan, yes, dk, { details, msg, cols: process.stdout.columns || 100 }), b = body.slice(0, Math.max(0, h - foot.length))
      while (b.length < h - foot.length) b.push('')
      frame([...b, ...foot])
    }
    const ids = () => new Set([...plan.auto, ...plan.sudo, ...plan.skip.map(s => s.t), ...plan.ask.slice(0, 9).filter(q => yes.has(q.key)).flatMap(q => q.targets)].map(t => t.id))
    const done = (v: Set<string> | null) => { process.stdin.off('data', onKey); process.stdout.off('resize', draw); process.stdin.setRawMode(false); process.stdin.pause(); leave(); resolve(v) }
    const onKey = (b: Buffer) => {
      const k = b.toString(); msg = ''
      if (k === '\x03' || k === 'q' || k === '\x1b') return done(null)
      if (k === '\r' || k === '\n') {
        if (!plan.auto.length && !yes.size) { if (!plan.ask.length) return done(null); msg = 'ยังไม่ได้เลือกอะไร — กดเลขหน้าข้อที่อยากลบ' }
        else return done(ids())
      } else if (/^[1-9]$/.test(k) && plan.ask[+k - 1]) { const q = plan.ask[+k - 1]; yes.has(q.key) ? yes.delete(q.key) : yes.add(q.key) }
      else if (k === 'd') details = !details
      draw()
    }
    process.stdin.setRawMode(true); process.stdin.resume(); enter(); draw(); process.stdin.on('data', onKey); process.stdout.on('resize', draw)
  })
}
