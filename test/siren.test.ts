import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSiren, parseBooted, parseAdb, chooseTargets, iosPush, iosLink, androidLink, planFor, send, EXAMPLE, type Device, type Io } from '../src/tools/siren'

const UD = '9ABE4519-2D91-4A60-BE6D-574410B0B499'
const ios: Device = { kind: 'ios', id: UD, name: 'iPhone 16e' }, adr: Device = { kind: 'android', id: 'emulator-5554', name: 'emulator-5554' }
const GOOD = `[[push]]\nname = "ข้อความใหม่"\nbundle = "com.example.app"\npayload = '{"aps":{"alert":"hi"}}'\n[[link]]\nname = "โปรไฟล์"\nurl = "myapp://profile/123?a=1&b=2"\npackage = "com.example.app"\n`

test('the example shipped in the help text is itself valid', () => {
  const r = parseSiren(EXAMPLE); expect(r.errors).toEqual([]); expect(r.push.length).toBe(1); expect(r.link.length).toBe(1)
})
test('parseSiren: valid items pass (a query string with & is fine)', () => {
  const r = parseSiren(GOOD); expect(r.errors).toEqual([]); expect(r.link[0].url).toBe('myapp://profile/123?a=1&b=2'); expect(r.push[0].bundle).toBe('com.example.app')
})
test('parseSiren: rejects anything that could break out of a command line or is not a valid push', () => {
  const bad = (t: string) => parseSiren(t).errors.length
  const push = (extra: string) => `[[push]]\nname = "x"\n${extra}\n`
  expect(bad(push('bundle = "com.x; rm -rf ~"\npayload = \'{"aps":{}}\''))).toBe(1)             // shell metacharacters in bundle
  expect(bad(push('bundle = "com.x"\npayload = "not json"'))).toBe(1)
  expect(bad(push('bundle = "com.x"\npayload = \'{"hello":1}\''))).toBe(1)                      // no "aps"
  expect(bad(push(`bundle = "com.x"\npayload = '{"aps":{"alert":"${'x'.repeat(5000)}"}}'`))).toBe(1)   // over the 4 KB push limit
  const link = (u: string, p = '') => `[[link]]\nname = "x"\nurl = "${u}"\n${p}`
  expect(bad(link("myapp://a'; reboot; '"))).toBe(1); expect(bad(link('myapp://has space'))).toBe(1); expect(bad(link('no-scheme'))).toBe(1)
  expect(bad(link('myapp://ok', 'package = "bad package"'))).toBe(1); expect(bad(link('myapp://ok', 'package = "com.ok.app"'))).toBe(0)
  expect(parseSiren('= not toml').errors.length).toBe(1)
})
test('parseBooted: only Booted iOS simulators; parseAdb: only fully-up EMULATORS (a real phone is never a target)', () => {
  const json = JSON.stringify({ devices: { 'iOS-26-5': [{ udid: UD, name: 'iPhone 16e', state: 'Booted' }, { udid: '11111111-2222-3333-4444-555555555555', name: 'iPad', state: 'Shutdown' }], 'iOS-27-0': [] } })
  expect(parseBooted(json)).toEqual([ios]); expect(parseBooted('{ "devices": {} }')).toEqual([]); expect(parseBooted('not json')).toEqual([])
  const adb = 'List of devices attached\nR58M123ABC\tdevice\nemulator-5554\tdevice\nemulator-5556\toffline\nemulator-5558\tunauthorized\n'
  expect(parseAdb(adb)).toEqual([adr]); expect(parseAdb('List of devices attached\n')).toEqual([])
})
test('chooseTargets: push is iOS-only; one device is picked automatically; several need --device/--all; unknown ids are refused', () => {
  expect(chooseTargets([ios, adr], 'push').targets).toEqual([ios])
  expect(chooseTargets([adr], 'push').problem).toContain('iOS Simulator')
  expect(chooseTargets([], 'link').problem).toContain('ไม่มี simulator')
  expect(chooseTargets([ios, adr], 'link').problem).toContain('--device')
  expect(chooseTargets([ios, adr], 'link', undefined, true).targets).toEqual([ios, adr])
  expect(chooseTargets([ios, adr], 'link', 'emulator-5554').targets).toEqual([adr])
  expect(chooseTargets([ios, adr], 'link', 'R58M123ABC').problem).toContain('เฉพาะ simulator/emulator')   // a physical phone serial: refused
  expect(chooseTargets([ios, adr], 'push', 'emulator-5554').problem).toBeTruthy()                              // android can't take a push
})
test('commands: argv arrays only; push payload goes through stdin; the android url is single-quoted inside the one shell string', () => {
  expect(iosPush(UD, 'com.example.app')).toEqual(['xcrun', 'simctl', 'push', UD, 'com.example.app', '-'])
  expect(iosLink(UD, 'myapp://x')).toEqual(['xcrun', 'simctl', 'openurl', UD, 'myapp://x'])
  const a = androidLink('emulator-5554', 'myapp://p?a=1&b=2', 'com.example.app')
  expect(a.slice(0, 4)).toEqual(['adb', '-s', 'emulator-5554', 'shell']); expect(a[4]).toBe("am start -a android.intent.action.VIEW -d 'myapp://p?a=1&b=2' -p com.example.app")
  expect(a.length).toBe(5)
  const pl = planFor('push', { name: 'n', bundle: 'com.x', payload: '{"aps":{}}' }, ios); expect(pl.stdin).toBe('{"aps":{}}'); expect(pl.argv.join(' ')).not.toContain('aps')
})
test('send: --dry-run runs nothing; a real run reports success and failure per device', () => {
  const calls: string[][] = [], io: Io = { run: argv => { calls.push(argv); return argv[0] === 'adb' ? { code: 1, err: 'device offline' } : { code: 0, err: '' } } }
  const link = { name: 'โปรไฟล์', url: 'myapp://x' }
  const dry = send('link', link, [ios, adr], io, true); expect(calls.length).toBe(0); expect(dry.every(l => l.includes('would:'))).toBe(true)
  const real = send('link', link, [ios, adr], io, false); expect(calls.length).toBe(2)
  expect(real[0]).toContain('✓'); expect(real[1]).toContain('✗'); expect(real[1]).toContain('device offline')
})
test('runSiren end to end (temp config dir, fake devices): never sends without a booted simulator; sends exactly once when there is one; dry-run sends nothing', async () => {
  const { runSiren } = await import('../src/tools/siren')
  const dir = mkdtempSync(join(tmpdir(), 'dsiren-')); writeFileSync(join(dir, 'siren.toml'), GOOD); const prev = process.env.DESTROYER_CONFIG; process.env.DESTROYER_CONFIG = dir
  try {
    const calls: { argv: string[]; stdin?: string }[] = [], io: Io = { run: (argv, stdin) => { calls.push({ argv, stdin }); return { code: 0, err: '' } } }
    const args = (sub: string, name: string, extra: string[] = []) => ({ sub, name, flag: (n: string) => { const i = extra.indexOf('--' + n); return i >= 0 ? extra[i + 1] : undefined }, has: (n: string) => extra.includes('--' + n) })
    expect(await runSiren(args('push', 'ข้อความใหม่'), io, () => [])).toBe(2); expect(calls.length).toBe(0)                    // config found, but no device → asks to open one, sends nothing
    expect(await runSiren(args('push', 'ข้อความใหม่'), io, () => [adr])).toBe(2); expect(calls.length).toBe(0)                // an Android emulator cannot take the push → still nothing
    expect(await runSiren(args('push', 'ข้อความใหม่', ['--dry-run']), io, () => [ios])).toBe(0); expect(calls.length).toBe(0)  // dry-run
    expect(await runSiren(args('push', 'ข้อความใหม่'), io, () => [ios])).toBe(0); expect(calls.length).toBe(1)
    expect(calls[0].argv).toEqual(['xcrun', 'simctl', 'push', UD, 'com.example.app', '-']); expect(calls[0].stdin).toBe('{"aps":{"alert":"hi"}}')
    expect(await runSiren(args('push', 'ไม่มีชื่อนี้'), io, () => [ios])).toBe(1); expect(calls.length).toBe(1)               // unknown name → refuses
    expect(await runSiren(args('link', 'โปรไฟล์', ['--all']), io, () => [ios, adr])).toBe(0); expect(calls.length).toBe(3)    // iOS + Android
    expect(calls[2].argv[0]).toBe('adb'); expect(calls[2].argv[4]).toContain("-d 'myapp://profile/123?a=1&b=2'")
  } finally { prev === undefined ? delete process.env.DESTROYER_CONFIG : (process.env.DESTROYER_CONFIG = prev) }
})
