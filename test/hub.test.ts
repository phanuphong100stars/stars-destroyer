import { test, expect } from 'bun:test'
import { hubItems, hubView } from '../src/hub'

const ok = { autoBytes: 12.3e9, asks: 2, findings: [{ level: 'ok' as const, text: 'x' }], lowDisk: false }

test('hub: the three real tools, cleaner first, statuses from real inputs', () => {
  const it = hubItems(ok)
  expect(it.map(x => x.id)).toEqual(['destroyer', 'fever', 'siren'])
  expect(it[0].status).toBe('ล้างได้เลย 12.30 GB · ถาม 2 ข้อ')
  expect(it.map(x => x.warn)).toEqual([false, false, false])
  expect(it[1].status).toBe('ปกติ')
})

test('hub: warnings come from fever findings and low disk; nothing to clean says so', () => {
  const it = hubItems({ autoBytes: 0, asks: 0, findings: [{ level: 'warn', text: 'a' }, { level: 'warn', text: 'b' }, { level: 'ok', text: 'c' }], lowDisk: true })
  expect(it[0].status).toBe('เครื่องสะอาดแล้ว')
  expect(it[0].warn).toBe(true)
  expect(it[1]).toMatchObject({ warn: true, status: 'ต้องดู 2 เรื่อง' })
})

test('hub view: cursor marks the chosen row and the button names that tool', () => {
  const it = hubItems(ok), v = (n: number) => { const { body, foot } = hubView(it, n, { total: 500e9, avail: 80e9 }, 100); return { body: body.join('\n'), foot: foot.join('\n') } }
  expect(v(0).body).toContain('❯ 1  DESTROYER')
  expect(v(0).foot).toContain('[enter] เปิด DESTROYER')
  expect(v(1).body).toContain('❯ 2  FEVER')
  expect(v(1).body).not.toContain('❯ 1')
  expect(v(2).foot).toContain('[enter] เปิด SIREN')
  expect(v(0).body).toContain('16.0%')   // 80/500 free
})
