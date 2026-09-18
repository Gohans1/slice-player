# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người phát triển duy nhất (solo developer/curator) dùng cho nhu cầu cá nhân. Người dùng muốn thưởng thức những đoạn cao trào, điệp khúc đắt giá nhất của các bài hát yêu thích mà không phải nghe toàn bộ thời lượng bài gốc, đồng thời phát ngẫu nhiên (shuffle) giữa các đoạn cắt để giữ nhịp độ nghe nhạc tươi mới. Ngoài ra, đây là dự án thực hành việc điều phối AI lập trình (AI-orchestrated development), quan sát cách kết hợp các công nghệ và kiểm soát luồng kiến trúc.

## Product Purpose

Slice Player là trình phát nhạc desktop local-first cho phép nạp nhạc từ YouTube hoặc file FLAC cục bộ, hiển thị dạng sóng âm (waveform) để cắt và lưu các phân đoạn (slices/segments), sau đó phát trộn ngẫu nhiên từng đoạn nhạc. Thành công của sản phẩm là:
1. Thao tác cắt và phát lại mượt mà, phản hồi ngay lập tức, không độ trễ, không quảng cáo.
2. Lưu trữ toàn vẹn dữ liệu cắt đoạn trong cơ sở dữ liệu SQLite cục bộ.
3. Thể hiện mã nguồn sạch, tinh gọn, mô hình hóa chuẩn chỉ do AI thực thi dưới sự định hướng của dev.

## Positioning

Trình nghe nhạc "lát cắt" cá nhân (Virtual Track Slicing Player) chạy cục bộ, không tài khoản, không đám mây, không quảng cáo. Khác với các trình phát nhạc truyền thống phát tuần tự từ đầu đến cuối bài, Slice Player biến mỗi bài hát thành tập hợp các lát cắt độc lập, cho phép phát shuffle ngẫu nhiên theo 3 chế độ: chỉ các lát cắt, chỉ bài gốc, hoặc trộn cả hai.

## Operating Context

- Môi trường: Ứng dụng web desktop cục bộ (chạy nền trên Bun runtime, giao diện mở trên trình duyệt Edge/Chrome).
- Quy trình sử dụng:
  1. Nạp bài hát qua URL YouTube hoặc đường dẫn file `.flac` trên máy.
  2. Mở Studio Cắt Đoạn (Slice Studio), tương tác trực tiếp trên sóng âm WaveSurfer.js để tạo các mốc thời gian và đặt tên cho từng điệp khúc/đoạn nhạc.
  3. Bật chế độ phát ngẫu nhiên (Shuffle) và quản lý hàng đợi (Queue Drawer).

## Capabilities and Constraints

- Khả năng:
  - Tải và bóc tách metadata từ YouTube bằng `yt-dlp` hoặc file local bằng `music-metadata`.
  - Trích xuất waveform peaks trên server bằng `ffmpeg` để client load sóng âm tức thì mà không cần giải mã audio nặng nề trên trình duyệt.
  - Quản lý cơ sở dữ liệu SQLite cục bộ (`data/music.db`) qua Bun native SQLite.
  - Phát audio mượt mà, chống gián đoạn với Web Audio API và cơ chế tìm kiếm (seek) chính xác.
  - Phân loại 3 chế độ phát: `slices_only`, `original_only`, `mixed`.
- Ràng buộc:
  - Chạy thuần local trên máy người dùng, không phụ thuộc backend ngoài (ngoại trừ yt-dlp fetch audio).
  - Giới hạn thời lượng bài hát tối đa 30 phút để tối ưu hóa bộ nhớ và hiệu năng xử lý waveform.
  - UI tối ưu hóa trải nghiệm bàn phím/chuột trên desktop.

## Brand Commitments

- Tên sản phẩm: Slice Player.
- Bản sắc thị giác: Flexoki Dark (bảng màu đen inky, xám ấm và 8 màu nhấn mực in analog của Kepano), mang hơi thở của một công cụ chế tác âm thanh tối giản, tinh tế, không chói mắt.
- Ngôn ngữ & phong cách: Gọn gàng, trung thực, không rườm rà (Ponytail & Unslop philosophy).

## Evidence on Hand

- Giao diện web hoàn chỉnh với Tailwind CSS v4, React 19, Zustand, WaveSurfer.js.
- Bộ lưu trữ SQLite `data/music.db` với dữ liệu tracks và segments thực tế.
- Cache audio cục bộ trong `data/cache/audio/`.

## Product Principles

1. **Local-First & Zero Latency**: Mọi thao tác lưu mốc cắt, đổi âm lượng, đổi vị trí hàng đợi phải có hiệu lực ngay lập tức và lưu trực tiếp vào SQLite cục bộ.
2. **Nghe Đoạn Đắt Giá (Slices Over Full Tracks)**: Ưu tiên trải nghiệm nghe các đoạn cắt tinh túy hơn là phát trọn vẹn cả bài một cách thụ động.
3. **AI-Driven Minimal Craft**: Mã nguồn phải đạt độ tinh gọn tối đa, sử dụng chuẩn nền tảng nguyên bản (native DOM APIs, CSS tokens) trước khi thêm phụ thuộc, tuân thủ nguyên tắc "Lazy Senior Developer".
4. **Desktop Focused**: Tối ưu hóa cho chuột, bàn phím (phím tắt space, mũi tên tua, drag-drop native) và độ phản hồi cao.
