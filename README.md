# destroyer — ตัวล้างพื้นที่สำหรับ mobile dev

ล้างของที่กินที่บน Mac ของ Flutter / iOS / Android dev (Gradle, AVD, Simulator, DerivedData, node_modules, โมเดลที่โหลดค้าง ฯลฯ)
ทำงานคู่กับ [Mole](https://github.com/tw93/Mole): Mole = ของทั่วไป (cache, browser, brew) · destroyer = ของ mobile dev ที่ Mole ไม่แตะ

## รัน (ต้องมี [bun](https://bun.sh) — ไม่มี dependency อื่น)
```bash
cd ~/Project/Personal/destroyer
bun run src/cli.ts                 # สแกน → ติ๊กเลือก → แผน → พิมพ์ DESTROY → ลบ   (ต้องรันใน terminal)
# ให้พิมพ์สั้นๆ ว่า destroyer (ทำครั้งเดียว):
chmod +x src/cli.ts && ln -s "$PWD/src/cli.ts" ~/.local/bin/destroyer   # ต้องมี ~/.local/bin ใน PATH
```

**ครั้งแรกแนะนำ:** `destroyer apply --set safe --dry-run` (ดูแผนเฉยๆ) → `destroyer apply --set safe` (tier A ล้วน สร้างใหม่ได้) → ค่อยไปชุดใหญ่

## Flow ของ `destroyer` (พิมพ์คำเดียว)
สแกนสด → หน้าติ๊กเลือก (ติ๊กชุดเริ่มต้นไว้ให้) → แผน + gates → พิมพ์ `DESTROY` → หน้ารัน (แท่งแตก/เลขใหญ่/log) → สรุป

หน้าติ๊กเลือก: `↑↓`/`jk` เลื่อน · `space` เลือก · `a` tier A ทั้งหมด · `n` ไม่เลือก · `s` กลับชุดเริ่มต้น · `enter` ไปต่อ · `q` ออก (ออกที่ไหนก็ไม่ลบอะไร)

| คำสั่ง | ทำอะไร |
|---|---|
| `destroyer` | flow ข้างบน (ถ้าไม่ใช่ terminal = แค่สแกน) |
| `destroyer scan [--set ชุด] [--json] [--plain]` | ตารางเป้าหมาย แบ่ง tier A/B/C — **อ่านอย่างเดียว** |
| `destroyer apply --set ชุด` หรือ `--only id,id` | ลบแบบไม่ติ๊ก (ต้องระบุ — ไม่มีค่าเริ่มต้น) · `--dry-run` ดูแผนเฉยๆ · `--yes` ข้าม DESTROY (**เฉพาะแผนที่ไม่มี tier C**) · `--stop-daemons` หยุด Gradle daemon / Dart analysis server ให้เอง |
| `destroyer show <id>` | รายละเอียด + สิ่งที่ apply จะทำ |
| `destroyer discover [--min MB]` | หาโฟลเดอร์ใหญ่ที่ยังไม่มีใครดูแล |
| `destroyer add <โฟลเดอร์>` | เพิ่มเองบรรทัดเดียว (เขียน `~/.config/destroyer/targets.toml` ไม่ต้องมีโค้ด) |
| `destroyer new <ชื่อ>` · `check <ไฟล์>` | module แบบมีโค้ด: สร้าง template / ตรวจก่อนใช้ |
| `destroyer modules` · `set list\|show\|save\|default` | module ที่โหลด / ชุดสำเร็จรูป (`set save ชื่อ --only …`, `set default ชื่อ`) |

## กฎความปลอดภัย (เทสไว้ทั้งหมด — `bun test`)
- **dry-run ไม่แตะอะไรเลย** · ต้องพิมพ์ `DESTROY` (Enter เปล่า = ยกเลิก) · ไม่มี TTY ต้องใส่ `--yes` และแผนห้ามมี tier C
- **tier D ไม่มีอยู่จริง** — `checkPath` ปฏิเสธ `~` ทั้งโฟลเดอร์, `~/Library` ทั้งโฟลเดอร์, `~/.ssh`, `~/.claude`, `~/Documents`, Desktop, Downloads ฯลฯ และ path นอก home
- **ไม่ตาม symlink** — เป้าที่เป็น symlink ถูกปฏิเสธ; symlink ข้างในถูกลบเฉพาะตัวลิงก์ ไม่ใช่ปลายทาง; ตรวจ `realpath` ซ้ำก่อนลบ
- **ไม่รันผ่าน shell** — คำสั่งภายนอกรันจาก allowlist เท่านั้น: `xcrun simctl delete <uuid>`, `xcrun simctl runtime delete <uuid>`, `avdmanager delete avd -n <ชื่อ>`, `sdkmanager --uninstall <id>`
- **ไม่รันเป็น root** — ขั้นที่ต้อง `sudo` ถูกพิมพ์ให้คัดลอกไปรันเอง
- **แอปที่เป็นเจ้าของกำลังรัน = ข้ามเป้านั้น** (VS Code, Xcode, Simulator, Android emulator, …). เฉพาะ Gradle daemon / Dart analysis server ถามให้หยุดให้ได้ (`y/N`, ค่าเริ่มต้น N)
- **tier C เข้าชุดได้เฉพาะ `only = [...]`** ที่เขียนเอง — ชุด `tier = "A"` ไม่มีวันรวม C
- ทุกการลบเขียน log ที่ `~/Library/Logs/destroyer/YYYY-MM-DD.jsonl`

## Tier
**A** ล้างได้เลย สร้างใหม่เอง ไม่เสียข้อมูล · **B** ต้องโหลด/ติดตั้งใหม่ (ใช้เน็ตหรือเวลา) · **C** ตัดสินเอง (device, runtime, SDK, โมเดล)

## ไฟล์ตั้งค่า (`~/.config/destroyer/`, เปลี่ยนที่ได้ด้วย `DESTROYER_CONFIG`)
`config.toml` (`roots`, `ignore`) · `targets.toml` (เพิ่มโดย `add`) · `sets.toml` (ชุดของคุณ ทับ `config/sets.toml`) · `modules/*.ts` (module ส่วนตัว)

## Module
ไฟล์เดียวต่อหนึ่งชนิดใน `src/modules/`: `{ id, kind?, detect?, scan?, annotate? }` — ดูตัวอย่างที่ `src/modules/vscode.ts`.
module ส่ง **ข้อมูล** กลับ (path, ขนาด, tier, action) — ไม่ลบเอง; มีแต่ `src/exec.ts` ที่ลบ. ไฟล์ module ส่วนตัวคือโค้ดที่รันด้วยสิทธิ์คุณ วางเฉพาะไฟล์ที่เชื่อถือ

## ความเร็ว
สแกนรอบแรก ~15 วิ (บางโฟลเดอร์มีไฟล์เป็นแสน เช่น `.dartServer` 315,000 ไฟล์ → `du` ~11 วิ). ขนาดถูกจำไว้ 10 นาทีที่ `~/.cache/destroyer/du.json` → รอบถัดไป ~0.5 วิ (ล้างอัตโนมัติหลัง apply). `--fresh` = วัดใหม่ทั้งหมด. `discover` ข้ามโฟลเดอร์ที่ module ดูแลอยู่แล้ว (~2 วิ)

## สิ่งที่ตรวจแล้ว / ยังไม่ได้ตรวจ
- ✓ เทส: กฎ path, tier, ชุด, targets.toml, `set save/default`, การลบจริงบนโฟลเดอร์ชั่วคราว (ลบ/keepDir/symlink/ปฏิเสธ/dry-run), allowlist ของคำสั่ง, pattern ตรวจแอปที่รัน
- ✓ ทดสอบครบวงจร (สแกน → dry-run → ลบ → ปฏิเสธ tier C ด้วย `--yes` → log) และหน้าจอเลือก/รันผ่านเทอร์มินัลเสมือน บน **HOME ปลอม** (`HOME=$(mktemp -d)`)
- ✗ **ยังไม่เคยรันลบบนข้อมูลจริง** และคำสั่งภายนอก (`simctl delete`, `runtime delete`, `avdmanager`, `sdkmanager`) ผ่านเทสแค่ฝั่ง allowlist — ไม่ได้ถูกรันจริงในเทสเพราะจะแก้ระบบจริง → ใช้ครั้งแรกให้เริ่มจาก `--dry-run` และ tier A
- แท่งในหน้ารันเป็นแอนิเมชันตามเวลา ไม่ใช่ความคืบหน้าจริงของ `rm` (เป้าใหญ่ช้าจะค้างราว 92% จนเสร็จ)

## ยังไม่มี
`watch` (เตือนเมื่อดิสก์ใกล้เต็ม), ปุ่ม `i` ดูข้างในในหน้าติ๊ก
