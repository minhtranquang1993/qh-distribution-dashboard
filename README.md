# QH Distribution — Lead Quality Dashboard

Dashboard phân tích **chất lượng lead** từ file CSV form wholesale, xây riêng cho mục tiêu tối ưu
performance marketing: biết kênh/creative/quốc gia nào ra lead thật, kênh nào đang đốt tiền.

POC hiện **chỉ phân tích chất lượng lead**. Chưa tính CPL / CP-MQL — phần chi phí sẽ bổ sung
sau khi nối dữ liệu spend.

## Chạy

```bash
npm install
npm run dev
```

Mở trang, kéo thả file CSV wholesale vào. File 67MB vẫn parse được vì toàn bộ quá trình đọc →
chuẩn hóa → chấm điểm chạy trong Web Worker, giao diện không bị treo.

Repo có sẵn `public/sample.csv` (200 dòng, PII tổng hợp) để thử nhanh mà không cần file thật.

## Lệnh khác

| Lệnh | Việc |
|---|---|
| `npm run build` | Typecheck + build production |
| `npm run typecheck` | Chỉ kiểm tra type |
| `npm run lint` | ESLint |
| `npm test` | Unit test (Vitest) |
| `npm run sample` | Sinh lại `public/sample.csv` (dữ liệu tổng hợp, seed cố định) |
| `npm run verify:real -- <đường-dẫn-csv>` | Chạy pipeline trên file thật, in số liệu kiểm chứng |
| `npm run verify:pii` | Upload CSV lên **bản production build** rồi assert không PII nào lọt ra UI hay file export (cần `npm run build && npm run preview` chạy trước) |
| `npm run e2e -- <đường-dẫn-csv>` | Playwright: upload thật, bấm hết 9 tab, chụp screenshot |

## 9 màn hình

1. **Tổng quan** — submissions, contact duy nhất, MQL rate, high-budget rate, tỷ lệ trùng,
   độ phủ attribution, budget mix.
2. **Action Board** — xếp mọi segment vào Scale / Watch / Investigate / Fix Tracking /
   Cut-Exclude / Needs Spend Data. Đây là màn hình trả lời "cắt tiền ở đâu, dồn vào đâu".
3. **Kênh** — source / medium / biết-qua, kèm n, MQL rate, high-budget, trùng, thiếu UTM, confidence.
4. **Creative** — ma trận `utm_term × utm_content`, tìm ô nào đáng scale và ô nào cần thay creative.
5. **Geo** — top quốc gia theo MQL rate + cảnh báo geo không nhất quán (nghi proxy/VPN).
6. **Firmographic** — loại hình DN × ngân sách, phục vụ viết rule loại trừ.
7. **Brand** — top 20 thương hiệu được hỏi nhiều nhất.
8. **Xu hướng** — theo tháng, phát hiện đợt resubmit/spike.
9. **Lead Explorer** — search/filter/sort, export segment CSV (không PII).

## Lead Score (0–100)

| Thành phần | Điểm |
|---|---|
| Ngân sách | 5 – 40 |
| Loại hình DN | 8 – 25 (Wholesaler cao nhất) |
| Biết QH qua đâu | 6 – 15 (Tradeshow/LinkedIn/Referral cao nhất) |
| Tính nhất quán 3 quốc gia | 0 – 10 |
| Độ đầy đủ liên hệ | 0 – 10 |

Ngưỡng: **≥70 MQL**, 45–69 Nurture, <45 Low, còn lại **Review** (fail hard gate).

Hard gate chạy trước khi xếp tier: email/sĐT hợp lệ, có tên, không trùng, không tín hiệu rác,
và 3 quốc gia không trùng nhau. Một lead fail gate **không bao giờ** vào MQL.

## Bảo mật PII

| Môi trường | PII trong UI | Export CSV |
|---|---|---|
| `npm run dev` (local) | Có — dùng tra cứu nhanh | Không PII |
| Production (Vercel) | **Không** — worker xóa ngay khi parse | Không PII |

File export luôn bỏ `email`, `phone`, `name`, `company`, `website` để an toàn khi nạp làm
audience hoặc chạy ads. `.gitignore` chặn mọi file CSV trừ `public/sample.csv`.

`leadKey` (khóa dedupe hiển thị trong Explorer và file export) là **SHA-256 có salt**,
không chứa email/sĐT thô. Salt là 128 bit random sinh mới **mỗi lần nạp file** và không bao
giờ được render, export hay lưu lại — nên cùng một contact ở hai lần nạp khác nhau sẽ ra hai
`leadKey` khác nhau. Lý do: hash không salt chỉ là pseudonym, ai có sẵn danh sách email/SĐT đoán
trước (website công ty, LinkedIn) thì hash từng cái ra là tra được tên người thật. Có salt thì
file export mang về máy khác vô dụng.

`leadKey` ổn định **trong một lần parse** — đủ để dedupe chạy đúng. `npm run verify:pii` kiểm tra
cả hai tính chất này trên bản production build.

## Cấu trúc

```
src/
├── lib/
│   ├── normalize.ts     Chuẩn hóa field, parse UTM, validate email/sĐT, phát hiện rác
│   ├── scoring.ts       Trọng số lead score + hard gates + ngưỡng tier
│   ├── transform.ts     CSV rows → Lead đã chấm điểm (thuần, dùng chung worker & test)
│   ├── metrics.ts       Mọi phép tổng hợp + confidence + 3 chế độ mẫu số
│   └── actionBoard.ts   Xếp segment vào bucket hành động
├── workers/             Web Worker parse CSV
├── components/          9 màn hình + UI dùng chung
└── __tests__/           Unit test trên sample.csv
scripts/
├── make-sample.ts         Sinh public/sample.csv tổng hợp (seed cố định)
├── verify-real-data.ts    Chạy pipeline trên file thật, in số kiểm chứng
├── verify-production-pii.ts  Assert bản production không lộ PII qua UI / export
└── e2e-smoke.ts           Playwright smoke test
docs/columns.md          Mô tả 24 cột gốc + quy ước xử lý
```

## Nguyên tắc phân tích

- **Mặc định contact duy nhất.** Repeat submitter không được làm đẹp số liệu kênh nào.
- **Không khuyến nghị khi thiếu dữ liệu.** Segment nhỏ hoặc tracking hỏng vào nhóm
  Investigate / Fix Tracking, không vào Scale.
- **Nói rõ mẫu số.** Mỗi bảng đều hiện `n` cùng tỷ lệ, và nhãn confidence.
- **CPL chưa có thì không kết luận.** Các segment tốt nhưng thiếu chi phí nằm ở
  *Needs Spend Data* cho tới khi nối dữ liệu spend.
