// watch: tell me BEFORE the disk fills up. It never deletes anything — it measures free space and, when low, sends a notification.
// Runs as a launchd agent (watch install) that calls `destroyer watch check` every N minutes.
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { HOME, fmt, short, makeCtx, load, scan, saveCache } from './core'
import { disk, sum } from './view'
import { logDir } from './exec'
import { out, c, rule, rail, live } from './ui'

export const LABEL = 'com.stars.destroyer.watch'
export const plistPath = (home = HOME) => join(home, 'Library/LaunchAgents', `${LABEL}.plist`)
const stateFile = () => join(process.env.XDG_CACHE_HOME ?? join(HOME, '.cache'), 'destroyer/watch.json')
const readState = (): { lastNotify?: number } => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')) } catch { return {} } }
const writeState = (s: object) => { try { mkdirSync(dirname(stateFile()), { recursive: true }); writeFileSync(stateFile(), JSON.stringify(s)) } catch {} }

export const shouldNotify = (last: number | undefined, now: number, cooldownH: number) => !last || now - last >= cooldownH * 3_600_000
// argv for osascript (no shell). quotes/backslashes escaped so scan data can never break out of the AppleScript string
export const notifyArgs = (title: string, body: string) => { const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); return ['osascript', '-e', `display notification "${q(body)}" with title "${q(title)}"`] }
export const message = (avail: number, thrGB: number, reclaim: number) => ({ title: `destroyer · ดิสก์เหลือ ${fmt(avail)}`, body: `ต่ำกว่า ${thrGB} GB — ล้างตาม preset ได้ราว ${fmt(reclaim)} (ไม่ลบเอง) · รัน destroyer ใน terminal` })
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function plistFor(o: { bun: string; cli: string; everyMin: number; thresholdGB: number; cooldownH: number; path: string; log: string }) {
  const args = [o.bun, o.cli, 'watch', 'check', '--threshold', String(o.thresholdGB), '--cooldown', String(o.cooldownH)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map(a => `\n    <string>${xml(a)}</string>`).join('')}
  </array>
  <key>StartInterval</key><integer>${o.everyMin * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(o.path)}</string></dict>
  <key>StandardOutPath</key><string>${xml(o.log)}</string>
  <key>StandardErrorPath</key><string>${xml(o.log)}</string>
</dict>
</plist>
`
}

type A = { flag: (n: string) => string | undefined; has: (n: string) => boolean }
const stamp = () => c.dim(new Date().toISOString().slice(0, 19).replace('T', ' '))
const launchctl = (...argv: string[]) => Bun.spawnSync(['launchctl', ...argv])

export async function runWatch(sub: string, a: A): Promise<number> {
  const thr = +(a.flag('threshold') ?? 20), cool = +(a.flag('cooldown') ?? 6), every = +(a.flag('every') ?? 60)
  if (!(thr > 0 && cool >= 0 && every >= 1)) { out(c.rd('✗ ') + '--threshold/--cooldown/--every ต้องเป็นตัวเลข (threshold>0, every>=1)'); return 1 }
  const uid = process.getuid?.() ?? 501

  if (sub === 'check') {
    const dk = await disk(); if (!dk) { out(`${stamp()} ${c.rd('✗')} อ่านพื้นที่ว่างไม่ได้`); return 1 }
    if (dk.avail >= thr * 1e9) { out(`${stamp()} ${c.gr('✓')} ว่าง ${fmt(dk.avail)} (≥ ${thr} GB) — ไม่ต้องเตือน`); return 0 }
    const ctx = makeCtx(), { targets } = await scan(ctx, await load(ctx)); saveCache()
    const reclaim = sum(targets) - sum(targets.filter(t => t.action.kind === 'sudo'))   // targets = preset only
    const m = message(dk.avail, thr, reclaim), mode = a.flag('notify') ?? 'osascript'
    if (!a.has('force') && !shouldNotify(readState().lastNotify, Date.now(), cool)) { out(`${stamp()} ${c.am('⚠')} ว่าง ${fmt(dk.avail)} (< ${thr} GB) — เพิ่งเตือนไปแล้ว (cooldown ${cool} ชม.)`); return 0 }
    if (mode === 'osascript') Bun.spawnSync(notifyArgs(m.title, m.body))
    else if (mode === 'print') out(`${c.am('🔔')} ${c.b(m.title)}\n   ${m.body}`)
    writeState({ lastNotify: Date.now() })
    out(`${stamp()} ${c.am('⚠')} ว่าง ${fmt(dk.avail)} (< ${thr} GB) — ล้างตาม preset ได้ ~${fmt(reclaim)} · แจ้งเตือน: ${mode}`); return 0
  }

  if (sub === 'install') {
    const cli = realpathSync(process.argv[1]), bun = Bun.which('bun') ?? process.execPath   // the stable symlink (…/bin/bun), not the versioned Cellar path that `brew upgrade` deletes
    const pl = plistFor({ bun, cli, everyMin: every, thresholdGB: thr, cooldownH: cool, path: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', log: join(logDir(), 'watch.log') })
    if (a.has('print')) { out(pl); return 0 }
    out(rule('WATCH INSTALL'))
    out(`  ตรวจทุก ${c.b(every + ' นาที')} · เตือนเมื่อว่าง < ${c.b(thr + ' GB')} · เตือนซ้ำไม่เกินทุก ${cool} ชม.`)
    out(`  ${c.dim('เขียน')}  ${short(plistPath())}`); out(`  ${c.dim('โหลด')}  launchctl bootstrap gui/${uid}${a.has('no-load') ? c.dim('  (ข้าม: --no-load)') : ''}`)
    out(`  ${c.dim('log  ')}  ${short(join(logDir(), 'watch.log'))}`); out(`  ${c.gr('✓')} ${c.dim('ไม่ลบอะไรเลย — แค่วัดพื้นที่ว่างแล้วเตือน')}`)
    if (!a.has('yes')) { if (!live) { out(c.am('! ต้องใส่ --yes หรือรันใน terminal')); return 2 }; if ((prompt('ติดตั้ง? [y/N] ') ?? '').trim().toLowerCase() !== 'y') { out(c.dim('ยกเลิก')); return 0 } }
    mkdirSync(dirname(plistPath()), { recursive: true }); mkdirSync(logDir(), { recursive: true }); writeFileSync(plistPath(), pl)
    if (a.has('no-load')) { out(`${c.gr('✓')} เขียนไฟล์แล้ว (ยังไม่โหลด)`); return 0 }
    launchctl('bootout', `gui/${uid}/${LABEL}`)                       // replace an older copy if any
    const r = launchctl('bootstrap', `gui/${uid}`, plistPath())
    if (r.exitCode !== 0) { out(c.rd('✗ ') + `launchctl bootstrap ล้มเหลว: ${new TextDecoder().decode(r.stderr).trim()}`); return 1 }
    out(`${c.gr('✓')} ติดตั้งแล้ว — ถอนด้วย ${c.b('destroyer watch uninstall')}`); return 0
  }

  if (sub === 'uninstall') {
    if (!a.has('no-load')) launchctl('bootout', `gui/${uid}/${LABEL}`)
    if (existsSync(plistPath())) unlinkSync(plistPath())
    out(`${c.gr('✓')} ถอน watch แล้ว ${c.dim('(ลบ ' + short(plistPath()) + ')')}`); return 0
  }

  if (sub === 'status') {
    const dk = await disk(), last = readState().lastNotify, loaded = launchctl('print', `gui/${uid}/${LABEL}`).exitCode === 0
    rail('WATCH', [`${existsSync(plistPath()) ? c.gr('✓ มีไฟล์ launchd') : c.dim('○ ยังไม่ติดตั้ง')}  ${loaded ? c.gr('· กำลังทำงาน') : c.dim('· ไม่ได้โหลด')}`,
      dk ? `ว่างตอนนี้ ${c.b(fmt(dk.avail))} ${c.dim(`(เกณฑ์เตือนปัจจุบัน ${thr} GB → ${dk.avail < thr * 1e9 ? c.am('ต่ำกว่าเกณฑ์') : 'ปกติ'})`)}` : '',
      `เตือนล่าสุด ${last ? new Date(last).toLocaleString('th-TH') : c.dim('ยังไม่เคย')}`, '', c.dim('destroyer watch install [--threshold 20] [--every 60] [--cooldown 6]  ·  watch check  ·  watch uninstall')])
    return 0
  }
  out(c.rd('✗ ') + 'ใช้: destroyer watch status | check | install | uninstall'); return 1
}
