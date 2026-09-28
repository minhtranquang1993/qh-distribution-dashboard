# Cấu trúc dữ liệu — Wholesale form 2026

Nguồn: file export từ form "Data wholesale form - 2026" (22.684 dòng, 1/1 – 26/9/2026).

| Cột gốc | Ý nghĩa | Xử lý trong dashboard |
|---|---|---|
| `submission_id` | ID submission | Giữ nguyên, dùng làm khóa dòng |
| `submission_date` | Thời điểm submit (`1/1/2026 0:20`) | Giữ nguyên; tách tháng cho biểu đồ xu hướng |
| `URL` | Query string lúc submit (không có domain) | Parse UTM. Ưu tiên cao nhất cho attribution |
| `first_source_url` | URL first-touch (có domain) | Parse UTM làm fallback |
| `first_user_source` | Nguồn first-touch (`FB`, `Google`…) | Chuẩn hóa: `FB`→`facebook`, `google`→`google` |
| `first_user_medium` | Medium first-touch (`Lead`, `SEM`…) | Chuẩn hóa lowercase |
| `location` | Quốc gia tự khai theo IP | Dùng cho geo mismatch |
| `top-brands-you-are-looking-for` | Danh sách brand, phân tách bằng dấu phẩy | Tách mảng, sửa mojibake `?` → `'` |
| `estimated-monthly-amount-dollar-you-wish-to-buy-from-us` | Ngân sách mua/tháng | 5 bucket; `≥ $20k` = proxy "chất" |
| `in-which-country-is-your-business-registered` | Quốc gia đăng ký DN | Chiều phân tích geo chính |
| `country-to-distribute-products` | Quốc gia phân phối | Chiều phân tích geo |
| `type-company` | Loại hình DN | Trọng số 25đ trong lead score |
| `how-do-you-know-about-us` | Biết QH qua đâu | Trọng số 15đ |
| `Company` | Tên công ty | PII — chỉ hiện ở bản local |
| `Name` | Tên người liên hệ | PII — chỉ hiện ở bản local |
| `Email` | Email | PII — dùng làm khóa dedupe; không export |
| `calling-code` | Mã quốc gia | Ghép với `Phone` thành E.164 |
| `Phone` | Số điện thoại | PII — ghép `calling-code`; không export |
| `preferred-method-of-contact` | WhatsApp / Email | Thống kê |
| `your-type-of-business-or-the-website` | Free text | 82% rỗng → không dùng cho scoring |
| `g-recaptcha-response` | Token reCAPTCHA | Bỏ hoàn toàn (nặng, không mang thông tin phân tích) |
| `Week`, `Month`, `Day` | Ngày tách cột | Dự phòng khi thiếu `submission_date` |

## Quy ước chất lượng dữ liệu

**Dedupe.** Khóa = email đã chuẩn hóa nếu hợp lệ, nếu không mới dùng số điện thoại E.164. Lần gửi
thứ 2 trở đi của cùng một khóa bị đánh dấu `duplicate`.

**3 chế độ mẫu số.** Mọi bảng phân tích mặc định dùng *contact duy nhất*; bộ chuyển trên đầu trang
đổi giữa *tất cả submissions* (đo lưu lượng) và *nhóm trùng* (đo lạm phát).

**Confidence.** Segment dưới 30 lead = `exploratory`, 30–99 = `medium` (cần thêm dữ liệu),
từ 100 trở lên = `high`. Chỉ segment `high` mới có thể vào nhóm Scale.

**Hard gates.** Lead vượt qua các gate mới được xếp tier: email/sĐT hợp lệ, có tên, không trùng,
không có tín hiệu rác. Ba quốc gia khác nhau (`severe_geo_mismatch`) cũng bị chặn — dấu hiệu
proxy/VPN. Hai quốc gia lệch nhau chỉ bị trừ điểm, không chặn.

**Attribution.** Lưu riêng `submit_utm_*`, `first_touch_utm_*`, `chosen_utm_*` kèm
`attribution_basis` để không che mất chỗ thiếu tracking. Placeholder `{campaignname}`
bị loại khỏi giá trị campaign.

## PII

Bản production (Vercel) chạy với `noPii = true`: worker xóa `email`, `phone`, `name`,
`company`, `website` ngay khi parse. File export CSV **luôn** không chứa các cột này, kể cả
bản local, để an toàn khi nạp làm audience hoặc chạy ads.
