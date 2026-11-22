// terminal look & feel. Everything degrades to plain text when piped / NO_COLOR / --plain / --json.
export const plain = process.argv.includes('--plain') || process.argv.includes('--json')
export const color = (!!process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR && !plain
export const live = !!process.stdout.isTTY && color            // spinners / cursor tricks only on a real terminal
export const cols = () => process.stdout.columns || Number(process.env.COLUMNS) || 100
export const out = (s = '') => console.log(s)
export const vis = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

const rgb = (r: number, g: number, b: number) => (s: string) => (color ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : s)
export const c = {
  gr: rgb(63, 224, 138), am: rgb(255, 194, 77), or: rgb(255, 154, 92), rd: rgb(255, 92, 122), vi: rgb(181, 140, 255), bl: rgb(109, 167, 236),
  dim: rgb(125, 125, 140), hi: rgb(235, 235, 245), b: (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s),
}
export const tierC = { A: c.gr, B: c.am, C: c.or } as const
export const tierName = { A: 'ล้างได้เลย · สร้างใหม่เอง ไม่เสียข้อมูล', B: 'โหลด/ติดตั้งใหม่ · ใช้เน็ตหรือเวลา', C: 'ตัดสินใจเอง · ของที่คุณเลือกเก็บ/ทิ้ง' } as const

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
export function gradient(s: string, from = [255, 122, 69], to = [193, 75, 255]) {
  if (!color) return s
  const n = Math.max(1, s.length - 1)
  return [...s].map((ch, i) => (ch === ' ' ? ch : `\x1b[38;2;${lerp(from[0], to[0], i / n)};${lerp(from[1], to[1], i / n)};${lerp(from[2], to[2], i / n)}m${ch}`)).join('') + '\x1b[39m'
}
const GL: Record<string, string[]> = {
  D: ['████ ', '█   █', '█   █', '█   █', '████ '], E: ['█████', '█    ', '████ ', '█    ', '█████'], S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'], L: ['█    ', '█    ', '█    ', '█    ', '█████'], B: ['████ ', '█   █', '████ ', '█   █', '████ '],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'], N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'], G: [' ████', '█    ', '█  ██', '█   █', ' ████'], R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'], O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '], Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
}
const DG: Record<string, string[]> = {
  '0': ['███', '█ █', '█ █', '█ █', '███'], '1': [' █ ', '██ ', ' █ ', ' █ ', '███'], '2': ['███', '  █', '███', '█  ', '███'], '3': ['███', '  █', '███', '  █', '███'], '4': ['█ █', '█ █', '███', '  █', '  █'],
  '5': ['███', '█  ', '███', '  █', '███'], '6': ['███', '█  ', '███', '█ █', '███'], '7': ['███', '  █', '  █', '  █', '  █'], '8': ['███', '█ █', '███', '█ █', '███'], '9': ['███', '█ █', '███', '  █', '███'],
  '.': ['   ', '   ', '   ', '   ', ' █ '], ' ': ['   ', '   ', '   ', '   ', '   '],
}
export function bigText(str: string, font: Record<string, string[]>, wide: boolean) {
  const rows = ['', '', '', '', '']
  for (const ch of str) { const g = font[ch] ?? font[' '] ?? Array(5).fill('     '); for (let i = 0; i < 5; i++) rows[i] += (wide ? g[i].replace(/./g, '$&$&') : g[i]) + (wide ? '  ' : ' ') }
  return rows
}
export const bigNum = (s: string, paint = c.gr) => bigText(s, DG, true).map(l => paint(l))
export function banner(version: string) {
  if (!color) return
  const wide = cols() >= 136   // HELLBRINGER = 11 letters × 12 columns when doubled
  for (const l of bigText('HELLBRINGER', GL, wide)) out('  ' + gradient(l))
  out('  ' + c.dim(`hellbringer · mobile-dev toolbox · v${version} · dry-run first · allowlist ✓ · tier D locked`))
  out()
}
// proportional bar with 1/8 steps
export function bar(frac: number, width: number, paint: (s: string) => string) {
  const x = Math.max(0, Math.min(1, frac)) * width, full = Math.floor(x), rem = x - full, parts = '▏▎▍▌▋▊▉'
  const s = '█'.repeat(full) + (full < width && rem > 0.08 ? parts[Math.min(6, Math.floor(rem * 7))] : '')
  return paint(s) + ' '.repeat(Math.max(0, width - [...s].length))
}
export const rule = (title: string, paint = c.dim, right = '') => {
  const left = `── ${title} `, w = Math.max(8, Math.min(cols(), 100) - 4 - [...vis(left + right)].length)
  return paint(left) + paint('─'.repeat(w)) + (right ? ' ' + right : '')
}
export const rail = (title: string, lines: string[], paint = c.vi) => { out(paint('╭─ ') + c.b(title)); for (const l of lines) out(paint('│ ') + l); out(paint('╰─')) }

// live multi-line area (spinners). Keep every line shorter than the terminal width.
export class Live {
  private n = 0; private frame = 0; private timer?: ReturnType<typeof setInterval>
  constructor(private render: (frame: number) => string[]) {}
  private draw() { const next = this.render(this.frame); if (this.n) process.stdout.write(`\x1b[${this.n}A`); process.stdout.write(next.map(l => '\x1b[2K' + l).join('\n') + '\n'); this.n = next.length }
  start() { if (!live) return; process.stdout.write('\x1b[?25l'); this.draw(); this.timer = setInterval(() => { this.frame++; this.draw() }, 80) }
  stop() { if (!live) return; clearInterval(this.timer); this.draw(); process.stdout.write('\x1b[?25h') }
}
export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const word = (w: string) => bigText(w, GL, cols() >= 112)
