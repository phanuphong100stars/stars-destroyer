import type { Mod } from '../core'
// reporter: ไม่ลบอะไร แค่แปะ "commit ล่าสุดเมื่อไร" ให้ target ของ projects
export default {
  id: 'stale-projects', kind: 'reporter',
  async annotate(targets, { repos, sh }) {
    const notes: Record<string, string> = {}
    for (const r of repos()) {
      const ts = +(await sh`git -C ${r} log -1 --format=%ct`.quiet().nothrow().text()); if (!ts) continue
      const d = Math.floor((Date.now() / 1000 - ts) / 86400)
      const age = d < 1 ? 'วันนี้' : d < 14 ? `${d} วันก่อน` : `${Math.round(d / 7)} สัปดาห์ก่อน`
      for (const t of targets) if (t.paths[0]?.startsWith(r + '/')) notes[t.id] = `commit ล่าสุด ${age}`
    }
    return notes
  },
} satisfies Mod
