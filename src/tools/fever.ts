// fever: read-only check-up — battery, uptime, load, and what is eating the machine right now. It changes nothing.
import { fmt } from '../core'
import { out, c, rail } from '../ui'

export type Battery = { pct: number; state: string; remaining?: string; cycles?: number; condition?: string; maxCapacity?: number }
export type Proc = { pid: number; cpu: number; rssKB: number; cmd: string }
export type Finding = { level: 'ok' | 'warn'; text: string }

// ---------- parsers (pure: fed with the raw output of pmset / system_profiler / sysctl / ps) ----------
export function parseBatt(pmset: string, profiler = ''): Battery | null {
  const m = /(\d+)%;\s*([^;]+);(?:\s*(\d+:\d+) remaining)?/.exec(pmset); if (!m) return null   // desktop Macs print "No batteries available"
  const num = (re: RegExp) => { const x = re.exec(profiler); return x ? +x[1] : undefined }
  return { pct: +m[1], state: m[2].trim(), remaining: m[3] && m[3] !== '0:00' ? m[3] : undefined, cycles: num(/Cycle Count:\s*(\d+)/), condition: /Condition:\s*([A-Za-z ]+)/.exec(profiler)?.[1].trim(), maxCapacity: num(/Maximum Capacity:\s*(\d+)%/) }
}
export const parseBoot = (s: string) => { const m = /sec\s*=\s*(\d+)/.exec(s); return m ? +m[1] : null }
export const parseLoad = (s: string) => { const m = /([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null }
export function parsePs(text: string): Proc[] {
  const out: Proc[] = []
  for (const l of text.split('\n')) { const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(l); if (m) out.push({ pid: +m[1], cpu: +m[2], rssKB: +m[3], cmd: m[4] }) }
  return out
}
export const fmtUptime = (sec: number) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d ? `${d} วัน ${h} ชม.` : `${h} ชม.` }

// ---------- what is it? many helper processes of one app are summed into one line ----------
const NAMES: [RegExp, string][] = [
  [/GradleDaemon/, 'Gradle daemon'], [/analysis_server/, 'Dart analysis server'], [/Xcode\.app\/Contents\/MacOS\/Xcode/, 'Xcode'], [/Simulator\.app/, 'Simulator'],
  [/CoreSimulator/, 'CoreSimulator'], [/qemu-system|emulator\/emulator/, 'Android emulator'], [/Visual Studio Code/, 'VS Code'], [/Android Studio/, 'Android Studio'],
  [/mariadbd/, 'MariaDB'], [/postgres/, 'PostgreSQL'], [/redis-server/, 'Redis'], [/(^|\/)node( |$)/, 'node'], [/(^|\/)dart( |$)/, 'dart'], [/adb.*fork-server/, 'adb'],
]
// fallback: the executable name — arguments (" -x", " --x") dropped, paths with spaces stay whole, "Foo Helper (Renderer)" folded into "Foo"
export const labelOf = (cmd: string) => NAMES.find(([re]) => re.test(cmd))?.[1] ?? ((cmd.split(/ -/)[0].split('/').pop() || cmd).replace(/ Helper.*$/, '').replace(/ \(.*\)$/, '').trim() || cmd).slice(0, 28)
export function topBy(procs: Proc[], key: 'cpu' | 'rss', n = 5) {
  const m = new Map<string, { label: string; cpu: number; rssKB: number; n: number }>()
  for (const p of procs) { const label = labelOf(p.cmd), e = m.get(label) ?? { label, cpu: 0, rssKB: 0, n: 0 }; e.cpu += p.cpu; e.rssKB += p.rssKB; e.n++; m.set(label, e) }
  return [...m.values()].sort((a, b) => key === 'cpu' ? b.cpu - a.cpu : b.rssKB - a.rssKB).slice(0, n)
}

// ---------- the verdicts ----------
const stateTh = (s: string) => /^discharg/i.test(s) ? 'กำลังใช้แบต' : /^charging/i.test(s) ? 'กำลังชาร์จ' : /charged/i.test(s) ? 'ชาร์จเต็ม' : s
export function assess(i: { batt: Battery | null; uptimeSec: number | null; load: number[] | null; cores: number }, o: { rebootAfterDays?: number } = {}): Finding[] {
  const f: Finding[] = [], limit = o.rebootAfterDays ?? 14, b = i.batt
  if (b) {
    const low = b.pct < 20 && /^discharg/i.test(b.state)
    f.push({ level: low ? 'warn' : 'ok', text: `แบตเตอรี่ ${b.pct}% · ${stateTh(b.state)}${b.remaining ? ` · เหลือราว ${b.remaining} ชม.` : ''}${low ? ' — เสียบสายชาร์จได้แล้ว' : ''}` })
    if (b.condition || b.cycles != null || b.maxCapacity != null) {
      const bad = (!!b.condition && !/^normal$/i.test(b.condition)) || (b.maxCapacity != null && b.maxCapacity < 80) || (b.cycles != null && b.cycles >= 1000)
      f.push({ level: bad ? 'warn' : 'ok', text: `สุขภาพแบต ${b.condition ?? '?'} · ${b.cycles ?? '?'} รอบ · ความจุสูงสุด ${b.maxCapacity ?? '?'}%${bad ? ' — เริ่มเสื่อม ควรให้ศูนย์บริการดู' : ''}` })
    }
  }
  if (i.uptimeSec != null) { const over = i.uptimeSec / 86400 >= limit; f.push({ level: over ? 'warn' : 'ok', text: `เปิดเครื่องมา ${fmtUptime(i.uptimeSec)}${over ? ` — เกิน ${limit} วัน รีสตาร์ทได้แล้ว (ล้างหน่วยความจำ รับอัปเดต)` : ''}` }) }
  if (i.load && i.cores > 0) { const busy = i.load[0] / i.cores > 1; f.push({ level: busy ? 'warn' : 'ok', text: `load ${i.load.join(' · ')} จาก ${i.cores} แกน${busy ? ' — เครื่องกำลังยุ่ง' : ''}` }) }
  return f
}

// ---------- gathering (argv only, never a shell; every command is read-only) ----------
type Sh = (argv: string[]) => string
const run: Sh = argv => { try { const r = Bun.spawnSync(argv); return r.exitCode === 0 ? new TextDecoder().decode(r.stdout) : '' } catch { return '' } }
export function collect(sh: Sh = run, nowMs = Date.now()) {
  const pm = sh(['pmset', '-g', 'batt']), hasBatt = /\d+%/.test(pm)
  const boot = parseBoot(sh(['sysctl', '-n', 'kern.boottime']))
  return {
    batt: parseBatt(pm, hasBatt ? sh(['system_profiler', 'SPPowerDataType']) : ''), uptimeSec: boot == null ? null : Math.max(0, Math.floor(nowMs / 1000) - boot),
    load: parseLoad(sh(['sysctl', '-n', 'vm.loadavg'])), cores: +sh(['sysctl', '-n', 'hw.ncpu']).trim() || 0, procs: parsePs(sh(['ps', '-Ao', 'pid=,pcpu=,rss=,command=', '-r'])),
  }
}

export async function runFever(a: { has: (n: string) => boolean; flag: (n: string) => string | undefined }): Promise<number> {
  const info = collect(), after = +(a.flag('reboot-after') ?? 14), findings = assess(info, { rebootAfterDays: after > 0 ? after : 14 })
  const ram = topBy(info.procs, 'rss'), cpu = topBy(info.procs, 'cpu')
  if (a.has('json')) { out(JSON.stringify({ ...info, procs: undefined, findings, topRam: ram, topCpu: cpu }, null, 1)); return 0 }
  const L = findings.map(x => `${x.level === 'ok' ? c.gr('✓') : c.am('⚠')} ${x.text}`)
  L.push('', c.b('กินหน่วยความจำมากสุด'), ...ram.map(r => `  ${r.label.padEnd(26)} ${fmt(r.rssKB * 1024).padStart(9)} ${c.dim(r.n > 1 ? `· ${r.n} โปรเซส` : '')}`))
  L.push('', c.b('กิน CPU มากสุด'), ...cpu.map(r => `  ${r.label.padEnd(26)} ${(r.cpu.toFixed(0) + '%').padStart(9)} ${c.dim(r.n > 1 ? `· ${r.n} โปรเซส` : '')}`), '', c.dim('FEVER อ่านอย่างเดียว ไม่แก้อะไร · ปิดโปรเซสไม่ได้จากหน้านี้'))
  rail('FEVER — ไข้เครื่อง', L, findings.some(x => x.level === 'warn') ? c.am : c.vi)
  return 0
}
