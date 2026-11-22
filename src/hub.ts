// hub: bare `hellbringer` in a terminal. One entry per tool; Enter opens the highlighted one. The cursor starts on the cleaner, so the old "one Enter" still means "clean".
import { fmt } from './core'
import { c, gradient } from './ui'
import { meter, type Disk } from './view'
import { enter, leave, frame } from './tui'
import type { Finding } from './tools/fever'

export type Tool = 'destroyer' | 'fever' | 'siren'
export type Item = { id: Tool; code: string; blurb: string; warn: boolean; status: string }

// pure: what each line says. siren is not probed here (`adb devices` would start the adb daemon just for opening a menu).
export function hubItems(i: { autoBytes: number; asks: number; findings: Finding[]; lowDisk: boolean }): Item[] {
  const bad = i.findings.filter(f => f.level === 'warn').length, todo = i.autoBytes > 0 || i.asks > 0
  return [
    { id: 'destroyer', code: 'DESTROYER', blurb: 'ล้างพื้นที่ — เห็นก่อน ยืนยันก่อน ลบได้เฉพาะที่ตกลงไว้ใน preset', warn: i.lowDisk,
      status: todo ? `ล้างได้เลย ${fmt(i.autoBytes)}${i.asks ? ` · ถาม ${i.asks} ข้อ` : ''}` : 'เครื่องสะอาดแล้ว' },
    { id: 'fever', code: 'FEVER', blurb: 'ไข้เครื่อง — แบต · เปิดมานานแค่ไหน · load · ตัวกินเครื่อง (อ่านอย่างเดียว)', warn: bad > 0, status: bad ? `ต้องดู ${bad} เรื่อง` : 'ปกติ' },
    { id: 'siren', code: 'SIREN', blurb: 'ยิง push / deep link ทดสอบเข้า simulator · emulator (ไม่แตะเครื่องจริง)', warn: false, status: 'พร้อมยิง' },
  ]
}

export function hubView(items: Item[], cur: number, dk: Disk, cols: number): { body: string[]; foot: string[] } {
  const L = [`  ${c.b(gradient('HELLBRINGER'))} ${c.dim('· เครื่องมือสำหรับ dev')}`]
  if (dk) L.push(`  ${c.dim('ที่ว่างตอนนี้')} ${meter(1 - dk.avail / dk.total, 20)} ${c.b(fmt(dk.avail))} ${c.dim(`(${((dk.avail / dk.total) * 100).toFixed(1)}%)`)}${dk.avail / dk.total < 0.1 ? c.am(' เหลือน้อย') : ''}`)
  L.push('')
  items.forEach((x, i) => {
    L.push(`  ${i === cur ? c.rd('❯') : ' '} ${c.dim(String(i + 1))}  ${(i === cur ? c.b : c.hi)(x.code.padEnd(10))} ${x.warn ? c.am('● ' + x.status) : c.gr('○ ') + x.status}`, '        ' + c.dim(x.blurb.slice(0, Math.max(20, cols - 10))), '')
  })
  return { body: L, foot: ['  ' + c.dim('─'.repeat(40)), `  ${c.gr(c.b(`[enter] เปิด ${items[cur].code}`))}`, '  ' + c.dim(`↑↓ เลือก · 1-${items.length} เปิดเลย · q ออก (ไม่มีอะไรถูกเปลี่ยน)`)] }
}

// full-screen loop; resolves with the chosen tool, or null = quit
export function hubScreen(items: Item[], dk: Disk): Promise<Tool | null> {
  return new Promise(resolve => {
    let cur = 0
    const draw = () => {
      const h = process.stdout.rows || 40, { body, foot } = hubView(items, cur, dk, process.stdout.columns || 100), b = body.slice(0, Math.max(0, h - foot.length))
      while (b.length < h - foot.length) b.push('')
      frame([...b, ...foot])
    }
    const done = (v: Tool | null) => { process.stdin.off('data', onKey); process.stdout.off('resize', draw); process.stdin.setRawMode(false); process.stdin.pause(); leave(); resolve(v) }
    const onKey = (b: Buffer) => {
      const k = b.toString()
      if (k === '\x03' || k === 'q' || k === '\x1b') return done(null)
      if (k === '\r' || k === '\n') return done(items[cur].id)
      if (/^[1-9]$/.test(k) && items[+k - 1]) return done(items[+k - 1].id)
      if (k === '\x1b[A' || k === 'k') cur = Math.max(0, cur - 1)
      else if (k === '\x1b[B' || k === 'j') cur = Math.min(items.length - 1, cur + 1)
      draw()
    }
    process.stdin.setRawMode(true); process.stdin.resume(); enter(); draw(); process.stdin.on('data', onKey); process.stdout.on('resize', draw)
  })
}
