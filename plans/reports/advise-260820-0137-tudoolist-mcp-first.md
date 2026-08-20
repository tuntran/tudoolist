# Advise: tudoolist — MCP-first personal tracker

Ngày: 2026-08-20 · Nguồn: `/ak-advise` interview session 2026-08-19 → 08-20
Trạng thái: **đã chốt · bước 1-8 xong, chạy thật trên `dooit.tuntran.com` với 12 tool + D1
(dữ liệu đang là mock). Habit cắt khỏi v1 — xem D9**
Thay thế: `plans/260819-1508-client-project-habit-tracker/spec.md` (spec đó **sai** ở 2 điểm cốt lõi, xem §8)

---

## 1. Problem (reframed)

Cần backing store cá nhân cho task/backlog/habit mà **agent là client hạng nhất** — goclaw,
Claude Code, Claude Desktop đều gọi được qua remote MCP.

TickTick không thay thế được vì 3 lý do (người dùng tự chọn, xếp theo thứ tự nêu):
1. Agent không đọc/ghi được dữ liệu
2. Data không thuộc về mình
3. Thiếu model `client` + tiền hợp đồng

## 2. Requirements

1. 4 entity: `client` → `project` → `task` (**list phẳng**, không subtask/tag) + `habit`/`habit_checkin` có streak
2. MCP Streamable HTTP tại `/mcp`, CRUD đầy đủ 4 entity
3. Public HTTPS, gọi được từ Claude Desktop + Claude Code + goclaw
4. Có auth, không để endpoint trần
5. Export JSON / SQL dump

## 3. Goals

- Thay hẳn chỗ ghi task đang dùng
- Tick habit + thêm task qua chat với agent
- Xem tình hình client/tiền qua agent

## 4. Non-goals (v1)

Web UI · mobile app · offline sync · Telegram bot riêng · sync GitHub Issues ·
hoá đơn/PDF · subtask/tag · multi-user/team · sprint/epic

## 5. Quyết định đã chốt

| # | Quyết định | Ngày | Ghi chú |
|---|---|---|---|
| D1 | **Không build Telegram bot.** goclaw đã nối Telegram, app chỉ expose MCP | 08-19 | Không webhook, không Cron Trigger |
| D2 | **Không có web UI ở v1.** v1 = `/mcp` + export | 08-19 | Xem lại sau 7 ngày dùng thật |
| D3 | **Hosted là vì agent gọi từ xa**, không phải vì mobile web | 08-19 | Đây là điểm spec cũ hiểu sai |
| D4 | **Cloudflare Workers + D1 + wrangler** | 08-20 | Đảo lại từ hướng VPS+SQLite; xem trade-off §9 |
| D5 | **TypeScript** | 08-20 | Hệ quả bắt buộc của D4 — Workers runtime là JS/V8 |
| D6 | **Auth = A + C**: nhận cả `Authorization: Bearer` **và** secret trong URL path | 08-20 | Xem §7 |
| D7 | Domain: **`dooit.tuntran.com`** | 08-20 | Workers custom domain, không cần tunnel |
| D8 | **Hai secret riêng**: `MCP_SECRET` (header) và `MCP_PATH_SECRET` (path) | 08-20 | Ép bởi phát hiện log §7b |
| D9 | **Cắt habit khỏi v1.** v1 chỉ `client` → `project` → `task` | 08-20 | Kéo theo: bỏ `habit_checkin`, bỏ streak; `today` chỉ còn task + tiền. Vào lại bằng `0002_*.sql` |
| D10 | **Tiền nằm ở `project`**, không phải `client` | 08-20 | Một người giao nhiều job, mỗi job có giá chốt và tiền ứng riêng |
| D11 | **Mọi tool result kèm `as_of`** (giờ local, `today`, tz, UTC) | 08-20 | Agent đọc ngày trần không biết nó tính theo UTC hay giờ VN — lệch nhau 7 tiếng mỗi ngày |
| D12 | **Tiền là log sự kiện, không phải tổng.** Bảng `payment`, bỏ cột `amount_paid` | 08-20 | Đảo lại D10 một nửa. Lý do ở §18 — cùng bài học với "streak là tính, không phải cột" (§12.3) |
| D13 | **Thống kê = `overview` + `query`**, không phải gọi list rồi tự cộng | 08-20 | `overview` tính trong SQL cho câu hỏi lặp lại; `query` (SELECT-only) cho phần tự custom |
| D14 | **Tách `project.description` khỏi `note`; repo là bảng riêng** | 08-20 | Scope viết một lần, trạng thái đổi hàng tuần — chung một ô thì đè nhau. Một dự án nhiều repo (frontend + api) nên không thể là cột |

## 6. Verdict

Đáng làm. Bản đã cắt scope (MCP + export, không web UI) là bản đầu tiên có kích thước
hợp lý — cỡ một cuối tuần.

Rủi ro thật **không nằm ở business logic** (task/habit là CRUD tầm thường) mà ở
**transport + auth**. Vì vậy thứ tự thi công phải là walking skeleton trước (§10).

## 7. Auth — phát hiện quyết định

**Bằng chứng:** ảnh chụp dialog "Add custom connector" của Claude Desktop (08-19).
Dialog chỉ có: Name · Remote MCP server URL · Advanced settings → OAuth Client ID / Secret.
**Không có field custom header.**

**Kết luận:** Claude Desktop **không nhận bearer token tĩnh**. Auth duy nhất nó hỗ trợ là OAuth.

3 đường đã cân nhắc:

| | Cách | Đánh giá |
|---|---|---|
| A | Bỏ Desktop khỏi v1, bearer header cho goclaw + Claude Code | Rẻ nhất |
| B | Tự viết OAuth authorization server | Rất nhiều máy móc để tự xác thực với chính mình. **Loại** |
| C | Secret nhúng trong URL path `/mcp/<hex>` | Cách duy nhất đưa shared secret vào Desktop |

**Chốt: A + C cùng lúc.** Một middleware nhận cả hai đường vào — nhưng **hai secret khác
nhau**, không phải một (D8, lý do ở §7b):
- goclaw & Claude Code → `Authorization: Bearer $MCP_SECRET`
- Claude Desktop → `$MCP_PATH_SECRET` trong path

**Threat model:** cái này bảo vệ *task list cá nhân*. Không tiền, không credential,
không dữ liệu người khác. TLS che path khi truyền → rủi ro thật là **log**
(request log của Cloudflare, file config Desktop) — tất cả đều là chỗ của mình.
Redact trong app log là cần nhưng **không đủ**; xem §7b.

**v2 nếu muốn làm đúng:** IdP sẵn có (Authentik/Keycloak/Auth0), server chỉ validate JWT +
serve protected-resource metadata, paste Client ID/Secret vào 2 field trong dialog.
Ít code hơn B rất nhiều. Không làm ở v1.

## 7b. Phát hiện khi test: redaction ở tầng app là KHÔNG đủ

**Sửa lại khẳng định trước đó của tài liệu này.** Bản nháp đầu ghi "tắt log path/query cho
`/mcp` ngay từ đầu" như thể đó là biện pháp đủ. **Sai.** Đo thực tế trên `wrangler dev`:

```
[wrangler:info] POST /mcp/34f72f80…eb190 200 OK (4ms)   ← platform log, app không chạm tới
POST /mcp/<redacted> -> 200                              ← log của app, sạch
```

Log của runtime nằm ngoài tầm với của Worker code. Trên production, Workers request logs
cũng ghi URL đầy đủ như vậy. → **Không thể ngăn path secret vào log.**

**Hệ quả → D8: tách hai secret.**

| Secret | Ai dùng | Có vào log không |
|---|---|---|
| `MCP_SECRET` | goclaw, Claude Code (header) | **Không** — không bao giờ nằm trong URL |
| `MCP_PATH_SECRET` | Claude Desktop (path) | **Có** — chấp nhận, xoay riêng được |

Xoay `MCP_PATH_SECRET` = add lại đúng 1 connector Desktop, không đụng goclaw/Claude Code.
Bỏ trống `MCP_PATH_SECRET` = tắt hẳn đường path (default đúng nếu không dùng Desktop).

Kiểm chứng đã chạy: bearer secret dùng ở path route → 401; path secret dùng ở header
route → 401. Hai đường không hoán đổi được.

Vẫn giữ redaction trong app log — nó giảm bề mặt, chỉ là không giải quyết trọn vẹn.

## 8. Vì sao spec cũ bị thay thế

`plans/260819-1508-client-project-habit-tracker/spec.md` sai 2 điểm cốt lõi:
1. Cho rằng hosted là vì **web UI mobile** → thật ra là vì **agent gọi từ xa** (D3)
2. Yêu cầu **web UI + Cloudflare Access** → v1 không có web UI (D2), và Access không giải
   quyết được vấn đề Desktop-không-có-header (§7)

Phần entity + non-goals của spec cũ vẫn đúng, đã hấp thụ vào §2/§4.

## 9. Trade-off (thành thật)

**Của D2 (không web UI):**
- Không có đường ghi dữ liệu nào khi agent không sẵn sàng. Agent chết → hôm đó không tick được.
- Giảm thiểu: `wrangler d1 execute` insert tay. Là workaround, không phải giải pháp.

**Của D4 (Workers thay vì VPS):**
- Mất "cùng box với goclaw" — thêm một mặt phẳng hạ tầng để debug.
- Export/backup phải qua `wrangler d1 export`, không còn `cp` một file SQLite.
- Đổi lại: không vận hành server, không tunnel, public HTTPS + custom domain miễn phí,
  không phải oncall khi VPS chết.

**Của D6 + D8 (secret in path):**
- Không revoke được từng client trong cùng một đường vào.
- Path secret **chắc chắn** vào Cloudflare request log, không ngăn được (§7b). Giảm thiểu
  bằng cách tách nó khỏi bearer secret, nên xoay chỉ tốn 1 thao tác trên Desktop.
- Secret xuất hiện trong file config Desktop trên máy local.

**Điều kiện khiến khuyến nghị hết đúng, và giá để đổi:**

| Nếu... | Thì... | Giá |
|---|---|---|
| Muốn tick habit trên phone >3 lần/tuần | Thêm web UI | ~1 ngày (schema + logic đã có) |
| Có người thứ 2 dùng chung | Bearer + toàn bộ giả định single-user sụp | Viết lại thật sự |
| Chán Workers/D1 limits | Về VPS + SQLite | ~1 ngày (đều là SQL) |

## 10. Đường thi công — walking skeleton trước

**Nguyên tắc: không viết tool thật trước khi cả 3 client gọi được `ping`.**

| Bước | Việc | Xong khi |
|---|---|---|
| 1 | Skeleton: Worker + `/mcp` Streamable HTTP + **đúng 1 tool `ping`**. Chưa DB, chưa entity | `wrangler dev` chạy |
| 2 | Auth middleware (1 file): 2 secret, header **và** path. `/healthz` không auth. Redact path trong app log | curl không secret → 401 |
| 3 | Test local: curl trước, rồi Claude Code → `localhost` | `ping` trả về |
| 4 | Deploy + custom domain `dooit.tuntran.com` | curl public → 200 |
| 5 | Nối cả 3: goclaw (header) · Claude Code (header) · Desktop (path) | cả 3 gọi được `ping` |
| **6** | **GATE — rủi ro hạ tầng đã chết** | ✅ |
| 7 | Schema D1 + seed dữ liệu **thật** | migration chạy |
| 8 | Tool CRUD per-entity + `habit_checkin` + `today` + `export` | ~12-14 tool |
| 9 | Backup cron + `CLAUDE.md` mô tả tool surface | |
| 10 | Dùng thật 7 ngày → mới quyết web UI | |

## 11. Thiết kế tool surface

**Per-entity tools, chỉ verb thật sự dùng qua chat.** Mục tiêu ~12-14 tool, không phải 20+
CRUD đầy đủ máy móc. (Có bao giờ xoá client bằng mồm không? Không → không cần tool đó.)

Cộng 2 tool "mục đích" ngoài CRUD:
- **`habit_checkin`** — verb tần suất cao nhất, xứng đáng tool riêng. Idempotent.
- **`today`** — **một call** trả toàn cảnh: habit chưa tick + streak + task đến hạn.
  ROI cao nhất trên mỗi dòng code trong cả app. Không có nó agent phải gọi 4 lần.

Cộng `export` (JSON + SQL dump) **là tool**, không chỉ CLI → agent dump được bất cứ lúc nào.

Mô tả tool viết cho agent đọc: nói rõ khi nào dùng, đơn vị ngày là gì.

Nếu vượt ~25 tool thì mới cân nhắc đổi sang generic dispatch (entity làm enum param).

## 12. 3 chi tiết dữ liệu sẽ cắn nếu bỏ qua

1. **Timezone.** Worker chạy UTC, người dùng UTC+7. Tick habit 22h tối sẽ ghi vào *ngày mai*
   nếu dùng timestamp UTC. → Cố định `APP_TZ=Asia/Ho_Chi_Minh`, lưu checkin là
   **chuỗi ngày local `YYYY-MM-DD`**, không phải timestamp.
2. **Idempotency.** Agent có retry. → `UNIQUE(habit_id, date)` + upsert. Không có thì
   một hôm nào đó streak sai vì double-tick.
3. **Streak là tính, không phải cột.** Derive từ bảng checkin. Quy mô cá nhân không bao giờ
   chậm; cột streak thì sẽ drift.

## 13. Không nên làm

- Đừng viết tool thật trước GATE §10 bước 6
- Đừng tự implement protocol MCP — dùng SDK
- Đừng thêm tag/subtask "tiện tay làm luôn" (non-goals có lý do)
- Đừng lưu streak thành cột
- Đừng để `/mcp` không auth, kể cả "chỉ mình tôi biết URL"
- Đừng thêm ORM + migration framework cho 5 bảng — `schema.sql` + file `001-*.sql` đánh số
- Đừng thêm log path/query cho `/mcp` (secret sẽ vào log)

## 14. Rẻ hơn / tốt hơn (xếp effort→impact)

1. **Tool `today`** — vài chục dòng, đổi lấy toàn bộ trải nghiệm hằng ngày
2. **Seed dữ liệu thật ngày đầu** — tracker rỗng chết trong 3 ngày. Rủi ro này **lớn hơn**
   mọi rủi ro kỹ thuật trong tài liệu này
3. **`CLAUDE.md` mô tả tool surface** — để agent dùng đúng tool không cần nhắc
4. **`export` là tool, không chỉ CLI**

## 15. Work checklist

- [x] Skeleton Worker + `/mcp` Streamable HTTP + tool `ping`
- [x] Auth middleware 1 file: `Authorization: Bearer` **hoặc** secret trong path (2 secret riêng, D8)
- [x] `/healthz` không auth
- [x] Redact path trong app log (lưu ý: platform log vẫn ghi, xem §7b)
- [x] Sinh secret `openssl rand -hex 32`, so sánh constant-time, 401 khi thiếu/sai
- [x] Verify `claude mcp add --transport http --header ...` — xác nhận có
- [x] Test local bằng curl + Claude Code (`claude mcp list` → Connected)
- [x] Deploy Workers + custom domain `dooit.tuntran.com` — verified 08-20, `/healthz` 200
- [ ] ⏸ Nối goclaw (header) — **hoãn 08-20 theo yêu cầu chủ dự án**, tự nối và tự verify sau. Không chặn GATE
- [x] Nối Claude Code (header) — verified trên localhost **và** production
- [x] Nối Claude Desktop (secret path) — connector gọi `ping` trả về `ok:true`
- [x] **GATE: `ping` chạy được từ Claude Code + Claude Desktop trên production** (goclaw tách ra sau)
- [x] Schema D1: `client`, `project`, `task` — `migrations/0001_init.sql`, tiền nằm ở `project`
- [ ] ⏸ `habit`, `habit_checkin` + `UNIQUE(habit_id, date)` — **cắt khỏi v1 ngày 08-20 theo quyết định
  chủ dự án** (xem D9). Vào sau bằng `0002_*.sql`, không phải viết lại
- [x] `APP_TZ` là var trong `wrangler.jsonc`, `due_date` lưu `YYYY-MM-DD` local
- [x] Mọi tool result kèm `as_of` (giờ local + `today` + tz + UTC) để agent không suy diễn sai ngày
- [x] Seed — **mock**, không phải dữ liệu thật (`seeds/mock.sql`: 3 client, 4 project, 15 task)
- [x] Tool CRUD per-entity — 19 tool kể cả `ping`, chỉ verb thật dùng
- [x] `project.description` tách khỏi `note`; bảng `repo` + `repo_add`/`repo_remove` (D14)
- [x] `client_update` — trước đó thêm khách thiếu sđt là không sửa lại được
- [x] Dữ liệu thật đầu tiên đã vào prod (khách + dự án 40tr), nằm cạnh mock
- [x] Bảng `payment` + `payment_add`/`payment_list`, bỏ cột `amount_paid` (D12, §18)
- [x] Tool `overview(month?)` — thu theo tháng/năm, còn nợ, dự án mới, task, theo client, 6 tháng gần
- [x] Tool `query(sql)` read-only — đã test chặn DELETE/UPDATE/multi-statement/comment che separator
- [ ] ⏸ Tool `habit_checkin` idempotent — theo habit, hoãn cùng D9
- [x] Tool `today` — quá hạn + đến hạn hôm nay + đang làm + 7 ngày tới + tiền còn nợ, 1 call
- [x] Tool `export` (JSON + SQL dump, escape dấu nháy đã test)
- [ ] ⏸ Streak tính từ checkin — theo habit, hoãn cùng D9
- [ ] Backup định kỳ `wrangler d1 export` + lưu off-Cloudflare (có `npm run db:backup`, chưa có lịch)
- [ ] `CLAUDE.md` mô tả tool surface
- [ ] Thay mock bằng dữ liệu thật
- [ ] Dùng thật 7 ngày trước khi quyết web UI

## 16. Success metrics

| Metric | Verify | Target |
|---|---|---|
| Endpoint có auth | `curl https://dooit.tuntran.com/mcp` không secret | **401** |
| Sai secret bị chặn | curl với path/token sai | **401/404** |
| Path secret hoạt động | curl `/mcp/<secret>` không header | **200** |
| Header hoạt động | curl `/mcp` với `Authorization: Bearer` | **200** |
| Claude Code nối được | `claude mcp add` → hỏi "list projects" | trả đúng project đã seed |
| Claude Desktop nối được | add connector với URL secret path | tool list hiện ra |
| goclaw nối được | tạo task qua goclaw | row xuất hiện trong D1 |
| Checkin idempotent | tick cùng habit 2 lần cùng ngày | `COUNT(*)` = **1** |
| Timezone đúng | tick lúc 23:30 giờ VN | `date` = ngày local, không UTC+1 |
| Streak đúng | fixture có gap 3 ngày | streak reset đúng chỗ |
| Export khôi phục được | export → import vào D1 rỗng | row count khớp **100%** |
| `today` đủ dùng | 1 call | có cả habit chưa tick + streak + task đến hạn |
| Secret không vào log | grep log sau 10 request | **0 hit** |
| **Adoption (quan trọng nhất)** | dùng 7 ngày liên tục | **≥7/7 ngày** có checkin hoặc task mutation |

## 17. Câu còn treo

1. ~~**goclaw viết bằng gì**~~ — **Go** (`go.mod`, `internal/mcp/` tại
   `~/Developer/lib/nextlevelbuilder/goclaw`). Việc nối đã hoãn 08-20, chủ dự án tự làm sau.
2. ~~**Zone `tuntran.com` đã ở trong Cloudflare chưa**~~ — **rồi**, custom domain đã live.
3. ~~**Claude Code `--header`**~~ — **đã xác nhận 08-20**: `claude mcp add --transport http
   <name> <url> --header "Authorization: Bearer ..."`. Đã nối thật, `claude mcp list` báo Connected.
4. **Flow OAuth chính xác Claude Desktop đòi gì** — chưa verify (chỉ có bằng chứng từ ảnh là
   *không có custom header*). Không chặn v1 vì đã chọn đường C.

## 18. Tiền: sửa lại thiết kế sau khi hỏi câu thống kê (08-20)

**Bối cảnh.** Sau khi bước 8 xong, câu hỏi đặt ra: *"tháng này nhận được bao tiền, có thêm dự án
nào, overview toàn bộ"*. Kiểm tra thì phát hiện câu đầu **không trả lời được với schema lúc đó**.

**Lỗi.** `project.amount_paid` là số tích luỹ. Khách ứng thêm 5tr → ghi đè 8000000 thành 13000000.
Ngày tiền về không được lưu ở đâu cả. Không tool nào cứu được vì dữ liệu không tồn tại.

Đây **đúng cái bẫy §12.3 đã cảnh báo** cho streak ("streak là tính, không phải cột") — lưu tổng
thay vì lưu sự kiện — chỉ khác là lần này rơi vào tiền, và không ai nhận ra khi thiết kế bảng.

**Sửa (`0002_payment.sql`).** Bảng `payment(project_id, amount, paid_date, note)`, `paid_date` là
ngày local. Bỏ cột `amount_paid`, số tiền đã trả thành `SUM(payment.amount)`. Số cũ chuyển thành
một dòng payment mỗi dự án, ghi rõ trong note là **ngày ước lượng** thay vì bịa ra ngày cụ thể.

Sửa sai bằng **dòng âm**, không sửa dòng cũ — giữ được cả cái đã tin lúc đó.

**Hệ quả tool.** `project_update` bỏ tham số tiền; thêm `payment_add` (nhận số vừa về, không phải
tổng mới) và `payment_list`. Verb hợp với chat hơn: *"anh Đức vừa chuyển 5tr"* thay vì phải đọc số
cũ rồi cộng nhẩm.

**Thống kê (D13).** `overview(month?)` tính trong SQL: thu trong tháng / trong năm / tổng, còn nợ,
dự án mới + theo status, task tạo/xong/quá hạn, chia theo client, 6 tháng gần nhất. `query(sql)`
chỉ cho `SELECT`/`WITH` — chặn comment che separator, chặn nhiều statement, D1 vốn chỉ chạy 1 câu,
SQLite không có data-modifying CTE.

**Bẫy đã kiểm chứng.** `created_at`/`done_at` là UTC, gom theo tháng local phải bù offset — đã test
bằng dự án tạo `2026-07-31T20:00Z` (03:00 ngày 01/08 giờ VN): rơi đúng vào tháng 8, tháng 7 không
đổi. Offset tính từ `APP_TZ` bằng phút, không hardcode `+7`. `paid_date` và `due_date` đã là ngày
local nên so sánh chuỗi trực tiếp, không cần bù.
