import { test, expect } from 'bun:test'
import { parseBatt, parseBoot, parseLoad, parsePs, fmtUptime, labelOf, topBy, assess, collect } from '../src/tools/fever'

// real outputs copied from a MacBook (pmset -g batt / system_profiler SPPowerDataType / sysctl)
const PMSET = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=22741091)\t85%; discharging; 7:55 remaining present: true\n"
const PROF = '          Cycle Count: 155\n          Condition: Normal\n          Maximum Capacity: 88%\n'
const base = { batt: parseBatt(PMSET, PROF), uptimeSec: 5 * 86400 + 8 * 3600, load: [1.41, 1.64, 1.74], cores: 8 }

test('parseBatt: percent, state, time left, cycles, condition, capacity; desktops and odd states', () => {
  expect(parseBatt(PMSET, PROF)).toEqual({ pct: 85, state: 'discharging', remaining: '7:55', cycles: 155, condition: 'Normal', maxCapacity: 88 })
  expect(parseBatt("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true")?.remaining).toBeUndefined()
  expect(parseBatt(' -InternalBattery-0\t85%; discharging; (no estimate) present: true')).toMatchObject({ pct: 85, remaining: undefined })
  expect(parseBatt('No batteries available')).toBeNull()
})
test('parseBoot / parseLoad / fmtUptime on real sysctl output', () => {
  expect(parseBoot('{ sec = 1794896828, usec = 505627 } Tue Nov 17 13:27:08 2026')).toBe(1794896828)
  expect(parseBoot('garbage')).toBeNull()
  expect(parseLoad('{ 2.38 2.11 1.94 }')).toEqual([2.38, 2.11, 1.94]); expect(parseLoad('')).toBeNull()
  expect(fmtUptime(5 * 86400 + 8 * 3600 + 14 * 60)).toBe('5 วัน 8 ชม.'); expect(fmtUptime(3 * 3600)).toBe('3 ชม.')
})
test('assess: a healthy machine has no warnings', () => { expect(assess(base).every(f => f.level === 'ok')).toBe(true); expect(assess(base).length).toBe(4) })
test('assess: low battery only warns while discharging', () => {
  const low = (state: string) => assess({ ...base, batt: { ...base.batt!, pct: 12, state } }).find(f => f.text.startsWith('แบตเตอรี่'))!
  expect(low('discharging').level).toBe('warn'); expect(low('charging').level).toBe('ok')
})
test('assess: worn battery (condition, <80% capacity, ≥1000 cycles) warns', () => {
  const w = (b: object) => assess({ ...base, batt: { ...base.batt!, ...b } }).find(f => f.text.startsWith('สุขภาพแบต'))!.level
  expect(w({ condition: 'Service Recommended' })).toBe('warn'); expect(w({ maxCapacity: 79 })).toBe('warn'); expect(w({ cycles: 1000 })).toBe('warn'); expect(w({ maxCapacity: 80, cycles: 999 })).toBe('ok')
})
test('assess: reboot hint after N days (default 14, configurable) and busy load per core', () => {
  const up = (days: number, o = {}) => assess({ ...base, uptimeSec: days * 86400 }, o).find(f => f.text.startsWith('เปิดเครื่อง'))!.level
  expect(up(13)).toBe('ok'); expect(up(14)).toBe('warn'); expect(up(7, { rebootAfterDays: 7 })).toBe('warn')
  const load = (l: number[], cores: number) => assess({ ...base, load: l, cores }).find(f => f.text.startsWith('load'))!.level
  expect(load([7.9, 5, 3], 8)).toBe('ok'); expect(load([9, 5, 3], 8)).toBe('warn')
})
test('assess: no battery (desktop) and unknown values do not crash or invent findings', () => {
  const f = assess({ batt: null, uptimeSec: null, load: null, cores: 0 }); expect(f).toEqual([])
})
test('labelOf: dev tools get names; helpers of one app share a label; fallback is the executable name', () => {
  expect(labelOf('/usr/bin/java -Dfoo -cp x org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.14')).toBe('Gradle daemon')
  expect(labelOf('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer')).toBe('VS Code')
  expect(labelOf('/opt/homebrew/opt/mariadb/bin/mariadbd --basedir=/opt/homebrew/opt/mariadb')).toBe('MariaDB')
  expect(labelOf('/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer -daemon')).toBe('WindowServer')
  const brave = (x: string) => `/Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Framework.framework/Helpers/${x}`
  expect(labelOf(brave('Brave Browser Helper (Renderer).app/Contents/MacOS/Brave Browser Helper (Renderer) --type=renderer'))).toBe('Brave Browser')   // helpers fold into the app
  expect(labelOf(brave('Brave Browser Helper (GPU).app/Contents/MacOS/Brave Browser Helper (GPU)'))).toBe('Brave Browser')
  expect(labelOf('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')).toBe('Brave Browser')
})
test('parsePs + topBy: sums processes per label and sorts by the chosen key', () => {
  const ps = parsePs('  404  13.2  81392 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer -daemon\n17366  12.1 704064 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/x\n17400   3.0 300000 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\nbad line\n')
  expect(ps.length).toBe(3)
  const ram = topBy(ps, 'rss'); expect(ram[0]).toMatchObject({ label: 'VS Code', n: 2, rssKB: 1004064 })
  const cpu = topBy(ps, 'cpu'); expect(cpu.map(x => x.label)).toEqual(['VS Code', 'WindowServer']); expect(cpu[0].cpu).toBeCloseTo(15.1)   // 12.1 + 3.0 beats WindowServer's 13.2 once summed
  expect(topBy(ps, 'rss', 1).length).toBe(1)
})
test('collect: wires the raw commands together (fake shell, read-only commands only)', () => {
  const seen: string[] = [], now = (1794896828 + 2 * 86400) * 1000
  const sh = (argv: string[]) => { seen.push(argv[0]); const k = argv.join(' '); return k === 'pmset -g batt' ? PMSET : k === 'system_profiler SPPowerDataType' ? PROF : k === 'sysctl -n kern.boottime' ? '{ sec = 1794896828, usec = 1 }' : k === 'sysctl -n vm.loadavg' ? '{ 1 2 3 }' : k === 'sysctl -n hw.ncpu' ? '8\n' : k.startsWith('ps ') ? '  1  1.0 100 /sbin/launchd\n' : '' }
  const r = collect(sh, now)
  expect(r).toMatchObject({ uptimeSec: 2 * 86400, cores: 8, load: [1, 2, 3] }); expect(r.batt?.pct).toBe(85); expect(r.procs.length).toBe(1)
  expect(new Set(seen)).toEqual(new Set(['pmset', 'system_profiler', 'sysctl', 'ps']))   // nothing that writes
  const desktop = collect(argv => argv[0] === 'pmset' ? 'No batteries available' : argv[0] === 'system_profiler' ? (() => { throw new Error('must not be called') })() : '', now); expect(desktop.batt).toBeNull()
})
