---
name: Slice Player
description: Trình nghe nhạc lát cắt virtual track cá nhân với bảng màu mực in Flexoki chuẩn 100%
colors:
  # Semantic Tokens (Shadcn Mapping)
  primary: "#4385BE"
  primary-foreground: "#FFFCF0"
  secondary: "#282726"
  secondary-foreground: "#E6E4D9"
  background: "#100F0F"
  foreground: "#CECDC3"
  card: "#1C1B1A"
  card-foreground: "#CECDC3"
  popover: "#1C1B1A"
  popover-foreground: "#CECDC3"
  muted: "#282726"
  muted-foreground: "#878580"
  accent: "#343331"
  accent-foreground: "#F2F0E5"
  destructive: "#D14D41"
  destructive-foreground: "#FFFCF0"
  border: "#343331"
  input: "#282726"
  ring: "#4385BE"

  # Flexoki Base Monochromatic Palette (15 values: paper to black)
  flexoki-paper: "#FFFCF0"
  flexoki-50: "#F2F0E5"
  flexoki-100: "#E6E4D9"
  flexoki-150: "#DAD8CE"
  flexoki-200: "#CECDC3"
  flexoki-300: "#B7B5AC"
  flexoki-400: "#9F9D96"
  flexoki-500: "#878580"
  flexoki-600: "#6F6E69"
  flexoki-700: "#575653"
  flexoki-800: "#403E3C"
  flexoki-850: "#343331"
  flexoki-900: "#282726"
  flexoki-950: "#1C1B1A"
  flexoki-black: "#100F0F"

  # Flexoki Standard 400 Accents (Dark Theme Primary)
  flexoki-red-400: "#D14D41"
  flexoki-orange-400: "#DA702C"
  flexoki-yellow-400: "#D0A215"
  flexoki-green-400: "#879A39"
  flexoki-cyan-400: "#3AA99F"
  flexoki-blue-400: "#4385BE"
  flexoki-purple-400: "#8B7EC8"
  flexoki-magenta-400: "#CE5D97"

  # Flexoki Standard 600 Accents (Light Theme Primary & Dark Theme Accent-2)
  flexoki-red-600: "#AF3029"
  flexoki-orange-600: "#BC5215"
  flexoki-yellow-600: "#AD8301"
  flexoki-green-600: "#66800B"
  flexoki-cyan-600: "#24837B"
  flexoki-blue-600: "#205EA6"
  flexoki-purple-600: "#5E409D"
  flexoki-magenta-600: "#A02F6F"

typography:
  display:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.025em"
  micro:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
  tiny:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2

rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: Slice Player

## Overview

**Creative North Star: "The Inky Soundboard"**

Slice Player mang linh hồn của một bàn điều khiển âm thanh mực in analog ấm áp: trầm tĩnh, đầm chắc, tôn trọng sự tập trung cao độ của người nghe nhạc. Toàn bộ giao diện được bao bọc bởi sắc đen mực in Flexoki Black (`#100F0F`) kết hợp với các bề mặt phân tầng xám ấm (Warm Charcoal Grayscale từ Flexoki 950 đến 850) và tái hiện 100% đặc tả Flexoki chính chủ của Steph Ango (Kepano). Không sử dụng những mảng màu neon lòe loẹt hay kính mờ (glassmorphism) quá đà, hệ thống lấy cảm hứng từ các thiết bị thu âm chuyên nghiệp nơi mỗi nút vặn, thanh trượt và vạch sóng âm đều có trọng lượng cơ học và phản hồi xúc giác rõ ràng.

Trải nghiệm thị giác được thiết kế theo tư duy "Tactile & Precision" - vừa có sự ấm áp của chất liệu giấy in cổ điển, vừa có độ chuẩn xác của phần mềm desktop chuyên dụng. Hệ thống hỗ trợ đầy đủ 14 nấc sắc độ Base Monochromatic (từ `#FFFCF0` Paper tới `#100F0F` Black) và trọn vẹn 8 cặp màu Accent (400 cho Dark Theme và 600 cho Light Theme) cùng thang mở rộng 50–950.

**Key Characteristics:**
- **Inky Analog Warmth**: Tông nền đen mực in đậm chất Flexoki, dịu mắt tuyệt đối khi nghe nhạc ban đêm.
- **Tonal Layering**: Phân biệt chiều sâu bằng các sắc độ tối (`#100F0F` -> `#1C1B1A` -> `#282726` -> `#343331`) kèm viền 1px tinh tế thay vì đổ bóng gắt.
- **Full 8-Hue Flexoki Ink Palette**: 8 màu mực in Flexoki (Đỏ, Cam, Vàng, Lục, Lam ngọc, Xanh dương, Tím, Hồng cánh sen) với chuẩn 400 (sáng trong tối) và 600 (đậm trong sáng).
- **Dual Light/Dark Architecture**: Hỗ trợ chuẩn mực cả Dark Mode (nền `#100F0F`) và Light Mode (nền `#FFFCF0`).
- **Compact Desktop Density**: Bố cục chặt chẽ, tối ưu diện tích cho thao tác chuột và bàn phím, mật độ hiển thị cao nhưng thoáng đãng.

## Colors

Bảng màu là sự hòa quyện giữa sắc đen mực in Flexoki và 8 màu nhấn mực in tương phản cao, mang lại độ ấm tương tự trang sách được in ấn thủ công.

### Primary
- **Flexoki Blue** (`#4385BE` ở Dark Mode, `#205EA6` ở Light Mode): Màu nhấn chủ đạo dùng cho các hành động quan trọng nhất (nút Play chính, active state trong hàng đợi, viền focus, thanh tiến trình mặc định).

### Secondary
- **Flexoki 900** (`#282726` ở Dark Mode, `#E6E4D9` ở Light Mode): Dùng làm nền phụ cho các nút điều hướng phụ, chip đếm, input fields và track trượt âm lượng.

### Tertiary & Accents (The 8 Flexoki Inks)
| Sắc độ (Hue) | Dark Theme (400 / 1) | Light Theme (600 / 2) | Vai trò trong Slice Player |
|---|---|---|---|
| **Red (re)** | `#D14D41` | `#AF3029` | Biểu tượng YouTube, cảnh báo xóa, lỗi tải audio |
| **Orange (or)** | `#DA702C` | `#BC5215` | Cảnh báo giới hạn độ dài track, lát cắt ấm |
| **Yellow (ye)** | `#D0A215` | `#AD8301` | Lát cắt tươi sáng, đánh dấu điểm nhấn đặc biệt |
| **Green (gr)** | `#879A39` | `#66800B` | Nút Shuffle lát cắt nhanh, thông báo lưu thành công |
| **Cyan (cy)** | `#3AA99F` | `#24837B` | Nhãn badge FLAC cục bộ, thời lượng lát cắt |
| **Blue (bl)** | `#4385BE` | `#205EA6` | Nút Play chính, con chạy thanh tua, lát cắt mặc định |
| **Purple (pu)** | `#8B7EC8` | `#5E409D` | Lát cắt trầm ấm, số thứ tự mốc cắt |
| **Magenta (ma)** | `#CE5D97` | `#A02F6F` | Con trỏ cursor định vị của WaveSurfer, lát cắt cao trào |

### Base Monochromatic Palette (14 nấc chuẩn Flexoki)
- **Paper** (`#FFFCF0`): Nền chính Light Mode (`bg`), chữ trên nút primary (`primary-foreground`).
- **Base 50** (`#F2F0E5`): Nền phụ Light Mode (`bg-2`).
- **Base 100** (`#E6E4D9`): Đường viền Light Mode (`ui`).
- **Base 150** (`#DAD8CE`): Viền hover Light Mode (`ui-2`), nền ô input Light Mode.
- **Base 200** (`#CECDC3`): Màu chữ chính Dark Mode (`tx`), viền active Light Mode (`ui-3`).
- **Base 300** (`#B7B5AC`): Chữ mờ nhạt Light Mode (`tx-3`).
- **Base 400** (`#9F9D96`): Sắc độ trung gian.
- **Base 500** (`#878580`): Chữ chú thích Dark Mode (`tx-2` / `muted-foreground`).
- **Base 600** (`#6F6E69`): Chữ chú thích Light Mode (`tx-2` / `muted-foreground`).
- **Base 700** (`#575653`): Chữ mờ nhạt Dark Mode (`tx-3`).
- **Base 800** (`#403E3C`): Viền active Dark Mode (`ui-3`), sóng âm WaveSurfer.
- **Base 850** (`#343331`): Đường viền chính Dark Mode (`ui-2` / `border`).
- **Base 900** (`#282726`): Nền input, viền phụ Dark Mode (`ui` / `secondary`).
- **Base 950** (`#1C1B1A`): Bề mặt thẻ Card, PlayerBar dock, Modal (`bg-2` / `card`).
- **Black** (`#100F0F`): Nền chính Dark Mode (`bg` / `background`), chữ chính Light Mode (`tx`).

### Named Rules
**The Ink and Paper Rule.** Màu nền và màu chữ phải luôn tuân thủ nguyên lý mực đen trên giấy ngà của Flexoki. Tuyệt đối không dùng màu trắng tinh khiết (`#FFFFFF`) cho các đoạn văn bản dài để tránh gây chói mắt.
**The Signal Color Rule.** Các màu nhấn chỉ chiếm dưới 5% diện tích màn hình, đóng vai trò là mực đánh dấu cho lát cắt âm thanh, không dùng làm màu nền cho các khối thẻ to lớn.
**The Dual 400/600 Contrast Rule.** Ở Dark theme, luôn dùng màu accent 400 (như Red `#D14D41`, Blue `#4385BE`) để đảm bảo độ tương phản cao trên nền tối. Ở Light theme, luôn dùng màu accent 600 (như Red `#AF3029`, Blue `#205EA6`) để mực đượm màu trên nền giấy ngà.

## Typography

**Display Font:** Plus Jakarta Sans (`'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
**Body Font:** Plus Jakarta Sans (`'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
**Label/Mono Font:** JetBrains Mono (`'JetBrains Mono', monospace`)

**Character:** Sự kết hợp hoàn hảo giữa nét hiện đại, hình học gọn ghẽ của Plus Jakarta Sans cho tiêu đề và nội dung thường ngày, cùng với chất kỹ thuật chính xác tuyệt đối của JetBrains Mono cho các con số thời gian và nhãn định danh.

### Hierarchy
- **Display** (Bold 700, 24px / 1.5rem, line-height 1.2, letter-spacing -0.025em): Tiêu đề chính của thư viện nhạc ("Thư Viện Nhạc", "Studio Cắt Đoạn").
- **Headline** (Semi-bold 600, 18px / 1.125rem, line-height 1.3): Tiêu đề hộp thoại Modal, tiêu đề popup.
- **Title** (Semi-bold 600, 14px / 0.875rem, line-height 1.4): Tên bài hát trên TrackCard, tiêu đề phân đoạn trong SliceStudio.
- **Body** (Regular 400, 14px / 0.875rem, line-height 1.5): Tên ca sĩ, văn bản hướng dẫn, mô tả chức năng.
- **Label** (Medium 500, 11px - 12px / 0.75rem, line-height 1, letter-spacing 0.025em): Đồng hồ đếm thời gian (`[01:12 → 01:45]`), số lượng bài hát, thẻ badge định dạng FLAC / YouTube.

### Named Rules
**The Monospace Time Rule.** Toàn bộ thông số thời gian (thời lượng bài, điểm bắt đầu/kết thúc lát cắt, phần trăm âm lượng) bắt buộc phải hiển thị bằng `JetBrains Mono` có độ rộng ký tự cố định (tabular numbers) để các con số không bị nhảy giật khi thời gian chạy.

## Layout

Hệ thống layout được thiết kế cố định theo mô hình Studio Desktop:
- **Thanh điều hướng trên cùng (Sticky Header)**: Chiều cao gọn gàng (48px - 56px), chứa logo, thanh tìm kiếm tức thời và 3 nút hành động chính (Shuffle đoạn, + File FLAC, + Link YouTube).
- **Vùng nội dung trung tâm (Main Canvas)**: Khung giới hạn tối đa `max-w-7xl` (1280px) căn giữa, hiển thị lưới thẻ bài hát tự động co giãn từ 1 cột (mobile) đến 4 cột (desktop `lg`).
- **Thanh phát cố định đáy màn hình (Fixed PlayerBar Dock)**: Vị trí `fixed bottom-0 left-0 right-0 z-40`, luôn hiển thị thumbnail bài đang phát, vạch màu lát cắt, cụm nút điều khiển trung tâm và thanh âm lượng.
- **Hàng đợi kéo trượt (Queue Drawer)**: Bảng trượt từ mép phải (`fixed inset-y-0 right-0 w-full max-w-sm z-50`) cho phép kéo thả reorder và chọn 3 chế độ phát nhạc.
- **Nhịp điệu khoảng cách (Spacing Rhythm)**: Bước nhảy theo thang bội số 4px/8px chuẩn mực (`4px`, `8px`, `12px`, `16px`, `24px`).

## Elevation & Depth

Giao diện áp dụng triệt để mô hình **Tonal Layering** (Phân tầng theo sắc độ nền) thay vì phụ thuộc vào bóng đổ:
- Lớp 0 (Canvas Base): `#100F0F` (Flexoki Black) / `#FFFCF0` (Flexoki Paper) - Nền sâu nhất của cửa sổ ứng dụng.
- Lớp 1 (Card & Drawer): `#1C1B1A` (Flexoki 950) / `#F2F0E5` (Flexoki 50) - Bề mặt nâng nhẹ cho thẻ bài hát và ngăn kéo hàng đợi.
- Lớp 2 (Hover & Inset): `#282726` (Flexoki 900) / `#E6E4D9` (Flexoki 100) - Nền cho các ô input, chip và trạng thái hover nhẹ.
- Lớp 3 (Active & Focus Accent): `#343331` (Flexoki 850) / `#DAD8CE` (Flexoki 150) - Trạng thái bấm giữ và đường viền phân tách 1px.

### Shadow Vocabulary
- **Dock Ambient** (`box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.45)`): Dùng ở mép trên của PlayerBar cố định đáy màn hình để tạo cảm giác dock tách biệt với canvas bên dưới.
- **Modal Elevation** (`box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6)`): Dùng cho các hộp thoại Modal (nạp YouTube, nạp file FLAC).
- **Card Focus Glow** (`box-shadow: 0 10px 25px -5px rgba(67, 133, 190, 0.15)`): Ánh sáng xanh dương khuếch tán cực nhẹ khi rê chuột vào TrackCard đang chọn.

### Named Rules
**The Crisp Border Rule.** Mọi thành phần phân tầng đều sử dụng viền 1px màu `border` (`#343331`) có độ mờ rõ ràng thay cho việc đổ bóng lớn. Cạnh viền phải dứt khoát và sắc nét.

## Shapes

- **Bo góc lớn**: `14px` (`0.875rem` - `rounded-xl`) cho các container lớn (TrackCard, Modal, Waveform Card).
- **Bo góc chuẩn**: `10px` (`0.625rem` - `rounded-lg`) cho thumbnail và card giao diện.
- **Bo góc trung bình**: `8px` (`0.5rem` - `rounded-md`) cho ô nhập liệu Input và nút bấm mặc định.
- **Bo góc nhỏ**: `6px` (`0.375rem` - `rounded-sm`) cho các nút bấm phụ và chip badge.
- **Bo tròn tuyệt đối (Pill)**: `9999px` (`rounded-full`) dành riêng cho nút Play/Pause tròn, nút hành động icon và các dải vạch màu định danh lát cắt.

## Components

### Buttons
- **Shape:** Bo góc nhẹ (`8px` hoặc `rounded-full` đối với nút icon).
- **Primary:** Nền xanh mực `#4385BE` (Light: `#205EA6`), chữ trắng ngà `#FFFCF0`, padding `8px 16px`. Nảy nhẹ (`scale-105`) khi rê chuột.
- **Destructive:** Nền đỏ Flexoki `#D14D41` (Dark) / `#AF3029` (Light), chữ `#FFFCF0`. Dùng cho nút "+ Link YouTube" và hành động xóa bài.
- **Outline:** Nền thẻ `#1C1B1A`, viền `#343331`, chữ `#CECDC3`. Đổi màu viền và chữ sang màu tương ứng khi hover (ví dụ viền xanh lục cho nút Shuffle).
- **Ghost:** Trong suốt, nền chuyển sang `#343331` khi hover.

### Cards / Containers (TrackCard)
- **Corner Style:** `rounded-xl` (`10px`).
- **Background:** `#1C1B1A` (Flexoki 950).
- **Border:** `1px solid #343331`, chuyển thành `#4385BE/40` khi hover.
- **Thumbnail:** Tỉ lệ 16:9 (`aspect-video`), bo góc `rounded-lg`, gắn badge nguồn (YouTube / FLAC) ở góc trên bên trái và thời lượng ở góc dưới bên phải.

### Inputs / Fields
- **Style:** Nền `#282726`, viền `#343331`, chữ `#CECDC3`, chiều cao `h-9` (`36px`), bo góc `rounded-md`.
- **Focus:** Viền chuyển thành `#4385BE`, vòng focus mờ `ring-1 ring-[#4385BE]`.

### Navigation & PlayerBar
- **PlayerBar Dock:** Nền `#1C1B1A/95` kết hợp hiệu ứng `backdrop-blur-md`, thumbnail 44x44px có vạch màu chân lát cắt, thanh tiến trình lát cắt dạng slider xúc giác với con trỏ tròn trượt mượt mà.
- **Drawer:** Ngăn kéo trượt bên phải hiển thị danh sách phát có tay cầm kéo thả (drag handle) và 3 nút chuyển chế độ phát nhanh.

### Signature Component: Slice Studio Waveform Deck
- Khung hiển thị sóng âm WaveSurfer với nền `#100F0F`, sóng màu xám `#403E3C`, dải tiến trình đỏ `#D14D41`, con trỏ hồng `#CE5D97`.
- Các vùng phân đoạn (Regions) được gán 8 màu ngẫu nhiên từ bảng màu Flexoki đầy đủ (Xanh dương, Lam ngọc, Lục, Vàng, Cam, Tím, Đỏ, Hồng), hiển thị viền kéo thả hai đầu trực quan.

## Do's and Don'ts

### Do:
- **Do** sử dụng mã màu Flexoki đã được định nghĩa trong `index.css` khi viết component mới.
- **Do** sử dụng font `JetBrains Mono` cho mọi hiển thị liên quan đến thời gian âm thanh (`00:00`), số thứ tự hàng đợi và nhãn kỹ thuật.
- **Do** giữ thanh điều khiển PlayerBar ở vị trí `fixed bottom-0` để người dùng có thể thao tác nhạc từ bất kỳ đâu.
- **Do** áp dụng `pointer-events-none` và `user-select: none` cho các thành phần kéo thả thumbnail để tránh lỗi kéo nhầm hình ảnh của trình duyệt.
- **Do** gán màu lát cắt (`activeSegment.color`) trực tiếp vào vạch màu thumbnail và thanh tiến trình để tạo dấu ấn thị giác nhận diện đoạn nhạc.

### Don't:
- **Don't** sử dụng nền trắng tinh (`#FFFFFF`) hoặc xám lạnh thông thường; toàn bộ bề mặt phải thuộc 14 nấc màu Base Flexoki ấm.
- **Don't** sử dụng gradient màu bóng bẩy hoặc chữ gradient rườm rà.
- **Don't** dùng các thư viện kéo thả hay modal nặng nề; ưu tiên các API DOM nguyên bản (`draggable`, `PointerEvent`, native `<input type="range">`).
- **Don't** làm mất đi tính xúc giác của thanh tiến trình: khi kéo tua, phải dừng phát tạm thời và cập nhật mượt mà theo từng pixel.
