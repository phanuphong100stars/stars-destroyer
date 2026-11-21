# destroyer — ตัวล้างพื้นที่สำหรับ mobile dev (ล็อกเป็น preset เดียว)

ล้างของที่กินที่บน Mac ของ Flutter / iOS / Android dev — **เฉพาะรายการที่อยู่ใน preset** (`config/preset.toml`) เท่านั้น
ทำงานคู่กับ [Mole](https://github.com/tw93/Mole): Mole = ของทั่วไป (cache, browser, brew) · destroyer = preset ของ mobile dev ที่ Mole ไม่แตะ

## ล็อกยังไง ("ทำได้แค่นี้")
- **แสดงเฉพาะสิ่งที่จะล้าง** — ของที่ไม่ตรง preset ไม่ถูกแสดงเลย (ไม่มี "ทั้งหมด")
- **บังคับที่ตัวลบ** — `applyTarget` ปฏิเสธทุก id ที่ไม่ตรง preset ไม่ว่าจะเรียกจากทางไหน (มีเทส) และ scan ตัดของนอก preset ทิ้งตั้งแต่ต้น
- **ไม่มีทางขยายขอบเขต**: ถอด `add` / `new` / `check` / `discover` / `set` / `modules`, ไม่โหลด module ส่วนตัว (`~/.config/destroyer/modules`) และ `targets.toml`, ไม่มี `--set` / `--only` — ใช้ได้แค่ `--skip` (เอาออกอย่างเดียว เพิ่มไม่ได้)
- **preset เป็นส่วนของโค้ด** ไม่ใช่ config ผู้ใช้ — จะเปลี่ยนขอบเขตต้องแก้ `config/preset.toml` แล้ว commit ที่ repo (ห้ามรูปแบบกว้างอย่าง `*` หรือ `projects:*` — โหลดไม่ผ่าน)

## รัน (ต้องมี [bun](https://bun.sh) — ไม่มี dependency อื่น)
```bash
cd ~/Project/Personal/destroyer
bun run src/cli.ts                 # แสดงสิ่งที่จะล้าง → เอาออกได้ → แผน → พิมพ์ DESTROY → ลบ   (ต้องรันใน terminal)
chmod +x src/cli.ts && ln -s "$PWD/src/cli.ts" ~/.local/bin/destroyer   # ให้พิมพ์สั้นๆ ว่า destroyer
```
**ครั้งแรกแนะนำ:** `destroyer apply --dry-run` (ดูแผนเฉยๆ) แล้วค่อย `destroyer`

| คำสั่ง | ทำอะไร |
|---|---|
| `destroyer` | สแกน → หน้าจอรายการ preset (ติ๊กไว้ทั้งหมด กด `space` เอาออกได้) → แผน + gates → พิมพ์ `DESTROY` → หน้ารัน → สรุป |
| `destroyer scan [--json]` | ดูอย่างเดียว — ไม่ลบ |
| `destroyer apply [--dry-run] [--yes] [--skip id,…] [--stop-daemons]` | ลบตาม preset แบบไม่ติ๊ก · `--dry-run` ดูแผนเฉยๆ · `--yes` ข้าม DESTROY (**เฉพาะแผนที่ไม่มี tier C**) · `--stop-daemons` หยุด Gradle daemon / Dart analysis server ให้เอง |
| `destroyer show <id>` | รายละเอียดของรายการใน preset |
| `destroyer preset` | preset อนุญาตอะไรบ้าง และเจอในเครื่องกี่รายการ (ที่ไม่พบ = ล้างไปแล้ว/ไม่มี) |
| `destroyer watch status\|check\|install\|uninstall` | เตือนก่อนดิสก์เต็ม (ดูหัวข้อ Watch) — **ไม่ลบอะไร** |

หน้าจอรายการ: `↑↓`/`jk` เลื่อน · `space` เลือก/เอาออก · **`i` ดูข้างใน** (path, ลบแล้วเกิดอะไร, สิ่งที่ apply จะทำ, แอปเจ้าของรันอยู่ไหม) · `a` tier A · `n` ไม่เลือก · `s` เลือกทั้งหมดตาม preset · `enter` ไปต่อ · `q` ออก (ออกที่ไหนก็ไม่ลบอะไร)

## กฎความปลอดภัยอื่น (เทสไว้ — `bun test`)
- **dry-run ไม่แตะอะไรเลย** · ต้องพิมพ์ `DESTROY` (Enter เปล่า = ยกเลิก) · ไม่มี TTY ต้องใส่ `--yes` และแผนห้ามมี tier C
- `checkPath` ปฏิเสธ `~` ทั้งโฟลเดอร์, `~/Library` ทั้งโฟลเดอร์, `~/.ssh`, `~/.claude`, `~/Documents`, Desktop, Downloads ฯลฯ และ path นอก home
- **ไม่ตาม symlink** — เป้าที่เป็น symlink ถูกปฏิเสธ; symlink ข้างในถูกลบเฉพาะตัวลิงก์; ตรวจ `realpath` ซ้ำก่อนลบ
- **ไม่รันผ่าน shell** — คำสั่งภายนอกจาก allowlist เท่านั้น: `xcrun simctl delete <uuid>`, `xcrun simctl runtime delete <uuid>`, `avdmanager delete avd -n <ชื่อ>`, `sdkmanager --uninstall <id>`
- **ไม่รันเป็น root** — ขั้นที่ต้อง `sudo` ถูกพิมพ์ให้คัดลอกไปรันเอง
- **แอปเจ้าของกำลังรัน = ข้ามเป้านั้น** (VS Code, Xcode, Simulator, Android emulator, …); Gradle daemon / Dart analysis server ถามให้หยุดให้ได้ (`y/N`, ค่าเริ่มต้น N)
- ทุกการลบเขียน log ที่ `~/Library/Logs/destroyer/YYYY-MM-DD.jsonl`

## Tier (แค่สำหรับแสดงผลและกฎ `--yes`)
**A** ล้างได้เลย สร้างใหม่เอง · **B** ต้องโหลด/ติดตั้งใหม่ · **C** ตัดสินเอง (device, runtime, SDK, โมเดล) — แผนที่มี C ต้องพิมพ์ `DESTROY` เสมอ

## Watch — เตือนก่อนดิสก์เต็ม (ไม่ลบเอง)
```bash
destroyer watch install                       # ตรวจทุก 60 นาที เตือนเมื่อว่าง < 20 GB (ถามยืนยันก่อน) — ปรับ: --threshold 25 --every 30 --cooldown 6
destroyer watch status | check [--notify print] | uninstall
destroyer watch install --print               # ดู plist ที่จะเขียน โดยไม่ติดตั้งอะไร
```
ติดตั้ง = เขียน `~/Library/LaunchAgents/com.stars.destroyer.watch.plist` + `launchctl bootstrap` (ไม่ติดตั้งเองจนกว่าคุณสั่ง). เมื่อต่ำกว่าเกณฑ์: สแกน → แจ้งเตือน macOS "ล้างตาม preset ได้ราว X GB" แล้วจบ; เตือนซ้ำไม่เกินทุก `--cooldown` ชม. · plist ใช้ path `bun` ถาวร (`…/bin/bun`) และฝัง `PATH` ตอนติดตั้ง · `--no-load` = เขียน/ลบไฟล์เฉยๆ (ทดสอบ)

## ความเร็ว
สแกนรอบแรก ~15 วิ (`.dartServer` มี 315,000 ไฟล์ → `du` ~11 วิ). ขนาดถูกจำไว้ 10 นาทีที่ `~/.cache/destroyer/du.json` → รอบถัดไป ~0.5 วิ (ล้างหลัง apply). `--fresh` = วัดใหม่ทั้งหมด

## ไฟล์
`config/preset.toml` (ขอบเขต — อยู่ใน repo) · `~/.config/destroyer/config.toml` (`roots` = ที่อยู่ git repo ของคุณ, ค่าเริ่มต้น `~/Project`) · `src/modules/*` (ตัวสแกน: ส่ง **ข้อมูล** กลับ ไม่ลบเอง) · `src/exec.ts` (ที่เดียวที่ลบ)

## สิ่งที่ตรวจแล้ว / ยังไม่ได้ตรวจ
- ✓ เทส (19): กฎ path, preset (รูปแบบ/การล็อก/ปฏิเสธ id นอก preset แม้ path ถูกต้อง), การลบจริงบนโฟลเดอร์ชั่วคราว (ลบ/keepDir/symlink/ปฏิเสธ/dry-run), allowlist คำสั่ง, pattern ตรวจแอปที่รัน, watch
- ✓ ทดสอบครบวงจรบน **HOME ปลอม**: scan โชว์เฉพาะ preset; ยัด module/targets.toml เอง, `--only`, `--set`, คำสั่งที่ถูกถอด → ลบของนอก preset ไม่ได้; หน้าจอเลือก/รันผ่านเทอร์มินัลเสมือน
- ✗ **ยังไม่เคยรันลบบนข้อมูลจริง** และคำสั่งภายนอก (`simctl`, `avdmanager`, `sdkmanager`) ผ่านเทสแค่ฝั่ง allowlist — ใช้ครั้งแรกให้เริ่มจาก `--dry-run`
- ✗ `watch install` ยังไม่เคยโหลดเข้า launchd จริง; แท่งในหน้ารันเป็นแอนิเมชันตามเวลา ไม่ใช่ความคืบหน้าจริงของ `rm`
