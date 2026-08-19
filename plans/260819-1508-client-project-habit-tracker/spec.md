# Spec: client / project / task / habit tracker

Trạng thái: **đang chờ xác nhận** — phục dựng từ ảnh chụp màn hình sau khi mất context.
Ngày: 2026-08-19

## Bối cảnh

Repo `tuntran/tudoolist` đã được wipe về trắng (1 commit `chore: initial commit`,
chỉ có README + .gitignore). Toàn bộ code Go/HTMX cũ và bản Cloudflare Workers
dựng thử đã bị xoá khỏi GitHub theo yêu cầu.

Spec dưới đây được người dùng mô tả trong session này lúc ~11:00 nhưng đoạn hội
thoại đó không còn trong context của agent. Nội dung được đọc lại từ ảnh chụp
màn hình người dùng gửi lúc 15:08. **Phần phía trên mục "Requirements" bị ảnh
cắt, có thể còn thiếu.**

## Requirements

1. **Entities** — quan hệ phân cấp:
   - `client`: tên, liên hệ, note, status, giá trị hợp đồng, đã trả, còn nợ, hạn thanh toán
   - `project`: thuộc 1 client, hoặc không thuộc client nào
   - `task`: title, status, priority, due, note — **list phẳng**, không subtask, không tag
2. `habit` + `habit_checkin` theo ngày, có **streak**
3. **Remote MCP server** — Streamable HTTP tại `/mcp`, expose CRUD đầy đủ cho cả 4 entity
4. **Web UI** — màn check habit 1 chạm + dashboard tổng thể đa dự án
5. Toàn bộ chạy trên **Cloudflare Workers + D1**
6. **Cloudflare Access** bảo vệ cả web UI lẫn `/mcp`; service token cho agent headless
7. Xuất data ra file được (JSON / SQL dump)

## Non-goals

Mobile native app · offline sync · sync GitHub Issues · xuất hoá đơn/PDF ·
log tương tác khách · subtask/tag · multi-user/team · sprint/epic.

## Quyết định đã chốt

**Telegram — không build bot riêng.** goclaw đã nối Telegram sẵn; app chỉ cần
expose MCP để goclaw gọi. Không webhook, không xử lý message, không Cron Trigger
đẩy nhắc nhở. Người dùng xác nhận 2026-08-19.

## Còn treo

- Phần requirements bị ảnh cắt — cần người dùng bổ sung nếu có mục nào phía trên
  mục 1 mà spec này chưa ghi.
- Chưa chốt có bắt đầu implement hay không.
