# IPTV Personal Render V2

Tính năng:
- Tự đồng bộ playlist Việt Nam từ IPTV-org
- Tự đồng bộ sau khi server khởi động và mỗi 24 giờ
- Trang xem TV + tìm kiếm + HLS.js
- `/admin`: sync IPTV-org, thêm kênh riêng, import M3U, bật/tắt/xóa
- MongoDB lưu danh sách kênh
- `/health` kiểm tra trạng thái

Render:
- Build Command: `npm install`
- Start Command: `npm start`

Environment:
- `ADMIN_KEY` = mật khẩu admin
- `MONGODB_URI` = MongoDB URI
- `AUTO_SYNC_HOURS` = số giờ giữa các lần đồng bộ (mặc định 24)
- `IPTV_ORG_URL` = playlist khác nếu muốn; mặc định `https://iptv-org.github.io/iptv/countries/vn.m3u`

Lưu ý: IPTV-org là danh mục cộng đồng của các URL stream công khai; stream có thể chết, bị geo-block hoặc thay đổi. Project không host video.
