-- Mock seed data. NOT real client work — invented to give the tools something
-- to read while the tool surface is being built.
--
-- DESTRUCTIVE: this clears every table before inserting. Production now holds
-- real client work alongside these rows, so `npm run db:seed:remote` would
-- delete it. Take a backup first, or stay on the local database:
--
--   npm run db:seed    local dev database — safe
--
-- Dates are spread across June–August so the monthly figures in `overview` have
-- something to actually differ between.

DELETE FROM repo;
DELETE FROM payment;
DELETE FROM task;
DELETE FROM project;
DELETE FROM client;

INSERT INTO client (id, name, phone, note) VALUES
  (1, 'Nguyễn Minh Đức', '0912345678', 'Chủ chuỗi cà phê, quen qua anh Hải'),
  (2, 'Trần Thu Hà',     '0987654321', 'Giảng viên, tự trả tiền, hay đổi yêu cầu'),
  (3, 'Lê Quốc Bảo',     '0903112233', 'Bán hàng online, cần gấp, chốt qua Zalo');

INSERT INTO project (id, client_id, name, status, amount_total, description, note, created_at) VALUES
  (1, 1, 'Website chuỗi cà phê Mộc',      'active', 35000000, 'Web giới thiệu 3 chi nhánh, menu riêng từng nơi, đặt bàn online', 'Ứng 40%, còn lại khi bàn giao',   '2026-07-01T02:00:00Z'),
  (2, 1, 'Landing page khai trương CS3',  'done',    6000000, 'Một trang, đếm ngược khai trương, gắn pixel quảng cáo',           'Đã thanh toán đủ',                '2026-07-20T02:00:00Z'),
  (3, 2, 'App điểm danh lớp học',         'active', 22000000, 'Điểm danh QR cho sinh viên, màn hình giảng viên, báo cáo chuyên cần', 'Ứng 8tr, chưa chốt phần báo cáo', '2026-08-02T03:00:00Z'),
  (4, 3, 'Bot chốt đơn Zalo',             'paused', 18000000, 'Nhận tin nhắn Zalo OA, tự tạo đơn từ nội dung chat',              'Client im từ đầu tháng',          '2026-06-15T03:00:00Z');

-- Project 3 spans two repos, which is why repos are rows rather than a column.
INSERT INTO repo (project_id, url, label) VALUES
  (1, 'https://github.com/example/moc-web',      NULL),
  (3, 'https://github.com/example/diemdanh-api', 'api'),
  (3, 'https://github.com/example/diemdanh-app', 'mobile');

INSERT INTO payment (project_id, amount, paid_date, note) VALUES
  (1, 10000000, '2026-07-15', 'Ứng đợt 1'),
  (1,  5000000, '2026-08-05', 'Ứng đợt 2'),
  (2,  6000000, '2026-07-28', 'Thanh toán một lần'),
  (3,  8000000, '2026-08-10', 'Tiền ứng'),
  (4,  5000000, '2026-06-20', 'Ứng trước khi dừng');

INSERT INTO task (project_id, title, status, due_date, note) VALUES
  (1, 'Trang menu theo từng chi nhánh',        'doing', '2026-08-22', NULL),
  (1, 'Đặt bàn online',                        'todo',  '2026-08-27', 'Chưa rõ có cần đặt cọc không'),
  (1, 'Tích hợp Google Maps cho trang liên hệ','todo',  NULL,         NULL),
  (1, 'Form đăng ký thẻ thành viên',           'todo',  NULL,         NULL),
  (1, 'Responsive lại trang chủ trên mobile',  'done',  NULL,         NULL),
  (2, 'Đếm ngược ngày khai trương',            'done',  NULL,         NULL),
  (2, 'Gắn pixel Facebook',                    'done',  NULL,         NULL),
  (3, 'Điểm danh bằng QR',                     'doing', '2026-08-21', NULL),
  (3, 'Xuất báo cáo chuyên cần ra Excel',      'todo',  '2026-08-30', 'Chưa chốt cột nào'),
  (3, 'Màn hình lớp học cho giảng viên',       'todo',  NULL,         NULL),
  (3, 'Push nhắc sinh viên trước giờ học',     'todo',  NULL,         NULL),
  (4, 'Nhận webhook tin nhắn Zalo OA',         'todo',  NULL,         NULL),
  (4, 'Tạo đơn từ tin nhắn',                   'todo',  NULL,         NULL),
  (NULL, 'Gia hạn domain tuntran.com',         'todo',  '2026-09-01', NULL),
  (NULL, 'Xuất hoá đơn tháng 8 gửi anh Đức',   'todo',  '2026-08-25', NULL);
