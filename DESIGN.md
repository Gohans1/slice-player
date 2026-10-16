---
name: Slice Player
description: Trình nghe nhạc lát cắt virtual track cá nhân với bảng màu mực in Flexoki chuẩn 100%
colors:
  # Semantic Tokens (Shadcn Mapping), dark theme values; the light theme uses the 600 inks (primary #AF3029)
  primary: "#D14D41"
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
  muted-foreground: "#9F9D96"
  accent: "#343331"
  accent-foreground: "#F2F0E5"
  destructive: "#D14D41"
  destructive-foreground: "#FFFCF0"
  border: "#282726"
  input: "#343331"
  ring: "#D14D41"

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
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: "2.125rem"
  headline:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: "1.625rem"
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
  mono:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"

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
- **Flexoki Red** (`#D14D41` ở Dark Mode, `#AF3029` ở Light Mode): Màu nhấn duy nhất, theo tín hiệu đỏ của Apple Music: nút Play chính, trạng thái đang phát (equalizer, tiêu đề bài đang phát), icon sidebar, vòng focus (`ring`), thanh âm lượng. `destructive` dùng cùng mã đỏ, nên hành động xoá được phân biệt bằng nhãn, icon và hộp xác nhận chứ không bằng màu.

### Secondary
- **Flexoki 900** (`#282726` ở Dark Mode, `#E6E4D9` ở Light Mode): Dùng làm nền phụ cho các nút điều hướng phụ, chip đếm, input fields và track trượt âm lượng.

### Tertiary & Accents (The 8 Flexoki Inks)
| Sắc độ (Hue) | Dark Theme (400 / 1) | Light Theme (600 / 2) | Vai trò trong Slice Player |
|---|---|---|---|
| **Red (re)** | `#D14D41` | `#AF3029` | Màu nhấn `primary` (Play, đang phát, vòng focus), biểu tượng YouTube, cảnh báo xóa, lỗi tải audio |
| **Orange (or)** | `#DA702C` | `#BC5215` | Cảnh báo giới hạn độ dài track, lát cắt ấm |
| **Yellow (ye)** | `#D0A215` | `#AD8301` | Lát cắt tươi sáng, đánh dấu điểm nhấn đặc biệt |
| **Green (gr)** | `#879A39` | `#66800B` | Nút Shuffle lát cắt nhanh, thông báo lưu thành công |
| **Cyan (cy)** | `#3AA99F` | `#24837B` | Nhãn badge FLAC cục bộ, thời lượng lát cắt |
| **Blue (bl)** | `#4385BE` | `#205EA6` | Lát cắt mặc định (`DEFAULT_SLICE_COLOR`), tên lát cắt trên PlayerBar |
| **Purple (pu)** | `#8B7EC8` | `#5E409D` | Lát cắt trầm ấm, số thứ tự mốc cắt |
| **Magenta (ma)** | `#CE5D97` | `#A02F6F` | Con trỏ cursor định vị của WaveSurfer, lát cắt cao trào |

### Base Monochromatic Palette (14 nấc chuẩn Flexoki)
- **Paper** (`#FFFCF0`): Nền chính Light Mode (`bg`), chữ trên nút primary (`primary-foreground`).
- **Base 50** (`#F2F0E5`): Nền phụ Light Mode (`bg-2`).
- **Base 100** (`#E6E4D9`): Đường viền Light Mode (`ui`).
- **Base 150** (`#DAD8CE`): Viền hover Light Mode (`ui-2`), nền ô input Light Mode.
- **Base 200** (`#CECDC3`): Màu chữ chính Dark Mode (`tx`), viền active Light Mode (`ui-3`).
- **Base 300** (`#B7B5AC`): Chữ mờ nhạt Light Mode (`tx-3`).
- **Base 400** (`#9F9D96`): Chữ chú thích Dark Mode (`muted-foreground`).
- **Base 500** (`#878580`): `tx-2` Dark Mode theo bản đồ chính chủ của Flexoki; không dùng cho chữ (xem The Secondary Text Contrast Rule).
- **Base 600** (`#6F6E69`): `tx-2` Light Mode theo bản đồ chính chủ; không dùng cho chữ, cùng lý do.
- **Base 700** (`#575653`): Chữ chú thích Light Mode (`muted-foreground` / `secondary-foreground`), chữ mờ nhạt Dark Mode (`tx-3`).

**The Secondary Text Contrast Rule.** Chữ phụ (`muted-foreground`) lệch `tx-2` của Flexoki đúng một bậc ra xa nền: Base 400 ở Dark Mode, Base 700 ở Light Mode. `tx-2` đạt 4.5:1 trên nền chính nhưng tụt xuống 3.9–4.5:1 trên card, hàng đang hover / đang phát và nền `muted`, mà chữ phụ của bảng và Up Next nằm đúng trên các nền đó. Một bậc lệch giữ mọi cặp từ 5.3:1 trở lên, và Base 400 cũng gần với chữ phụ trắng 64% của Apple Music.
- **Base 800** (`#403E3C`): Viền active Dark Mode (`ui-3`), sóng âm WaveSurfer.
- **Base 850** (`#343331`): Viền ô nhập và nền `accent` Dark Mode (`ui-2` / `input`).
- **Base 900** (`#282726`): Đường viền chính, nền `secondary` / `muted` Dark Mode (`ui` / `border`).
- **Base 950** (`#1C1B1A`): Bề mặt thẻ Card, nền kính của capsule PlayerBar (70%), Modal (`bg-2` / `card`).
- **Black** (`#100F0F`): Nền chính Dark Mode (`bg` / `background`), chữ chính Light Mode (`tx`).

### Named Rules
**The Ink and Paper Rule.** Màu nền và màu chữ phải luôn tuân thủ nguyên lý mực đen trên giấy ngà của Flexoki. Tuyệt đối không dùng màu trắng tinh khiết (`#FFFFFF`) cho các đoạn văn bản dài để tránh gây chói mắt.
**The Signal Color Rule.** Các màu nhấn chỉ chiếm dưới 5% diện tích màn hình, đóng vai trò là mực đánh dấu cho lát cắt âm thanh, không dùng làm màu nền cho các khối thẻ to lớn.
**The Dual 400/600 Contrast Rule.** Ở Dark theme, luôn dùng màu accent 400 (như Red `#D14D41`, Blue `#4385BE`) để đảm bảo độ tương phản cao trên nền tối. Ở Light theme, luôn dùng màu accent 600 (như Red `#AF3029`, Blue `#205EA6`) để mực đượm màu trên nền giấy ngà.

## Typography

**Display & Body Font:** Inter Variable (`'Inter Variable', sans-serif`), thay cho SF Pro của Apple Music (SF Pro không được cấp phép dùng trên web)
**Mono Font:** JetBrains Mono (`'JetBrains Mono', monospace`), chỉ cho ngữ cảnh kỹ thuật (xem The Tabular Time Rule)

**Character:** Inter trên thang cỡ chữ kiểu Apple (12 / 13 / 15 / 17 / 19 / 22 / 26px, token `text-2xs` → `text-2xl`): nội dung dày đặc ở 13px như Music, tiêu đề trang lớn và đậm, con số dùng chữ số tabular của chính Inter.

### Hierarchy
- **Display** (Bold 700, 26px / `text-2xl`): tiêu đề lớn của trang thư viện và tên playlist trong header.
- **Headline** (Bold 700, 17px / `text-base`): tiêu đề panel Up Next; tiêu đề trên toolbar dùng 17–19px (`text-base sm:text-lg`).
- **Title** (Regular 400, 13px / `text-xs`): tên bài trong bảng, Up Next và tile, màu chữ chính; tên bài trong LCD của player dùng Semi-bold 600.
- **Body** (Regular 400, 13px / `text-xs`): nghệ sĩ, mô tả, chi tiết phụ, màu `muted-foreground`.
- **Label** (Semi-bold 600, 12px / `text-2xs`): tiêu đề cột bảng, dòng chi tiết dưới tên playlist.

### Named Rules
**The Tabular Time Rule.** Mọi con số thay đổi theo thời gian hoặc xếp thành cột (thời lượng bài, điểm bắt đầu/kết thúc lát cắt, phần trăm âm lượng, số đếm) dùng chữ số đều nhau `tabular-nums` của font giao diện, như Apple Music dùng chữ số tabular của SF, để các con số không nhảy khi thời gian chạy. `JetBrains Mono` chỉ còn cho ngữ cảnh kỹ thuật: timecode khi chỉnh lát cắt trong Slice Studio, System Logs, phím tắt (keycap), URL và tên file lúc nhập.

## Layout

Bố cục 3 cột theo Apple Music (macOS Tahoe 26), dựng bằng shadcn Base UI (`base-mira`):
- **Sidebar trái (`AppSidebar`, shadcn `Sidebar collapsible="icon"`)**: rộng 16rem. Trên cùng là ô Search, rồi nhóm Library (Mix, Slices, Tracks, Downloading, Errors kèm số đếm), cây Playlists (playlist cha/con và mix; mỗi playlist có artwork 20px như Apple Music, vẽ trong ô 16px của icon bằng `-m-0.5` để tên thẳng hàng; playlist chưa có ảnh dùng icon), cuối cùng là các tiện ích (System Logs, Keyboard Shortcuts, Backup / Transfer, Language). Sidebar cao hết màn hình; PlayerBar là capsule trong cột giữa.
- **Cột giữa (`SidebarInset`)**: header dính trên cùng gồm tiêu đề + số mục, sắp xếp (`ToggleGroup` Manual / Newest / Oldest / Random), chế độ xem (`ViewModeToggle`: Grid / List, mặc định List), nhập Local Audio / YouTube và âm lượng tổng; bên dưới là nội dung thư viện. Chiều cao header đo vào `--library-toolbar-height`; cùng chiều cao capsule, nó thành `scroll-margin` của vùng nội dung (utility `clear-sticky-bars`), nên phần tử được focus không nằm dưới header hay capsule. Không dùng `scroll-padding` trên trang: header và capsule sticky trong cùng scroller, nên focus chính nút của chúng sẽ cuộn trang mỗi lần Tab. Như các trang của Apple Music, mỗi trang tự mở đầu bằng tiêu đề lớn: playlist bằng header của nó, các mục thư viện (Mix, Slices, Tracks, Downloading, Errors, Playlists) bằng tên `text-2xl font-bold`, số đếm `text-xs text-muted-foreground` và mô tả `text-2xs font-semibold`. Vì vậy tiêu đề trên header dính ẩn đi và chỉ hiện dần khi tiêu đề lớn cuộn khuất dưới header (scroll-driven animation `view-timeline` qua utility `page-title-timeline` / `reveal-past-page-title`, không dùng JS; trình duyệt không hỗ trợ thì luôn hiện).
- **Cột phải "Now Playing Queue" (`QueuePanel`)**: rộng `w-80`, dock cạnh nội dung, có 3 chế độ phát Mix / Slices / Tracks, sắp xếp bằng kéo thả hoặc nút lên/xuống.
- **PlayerBar (capsule)**: như Apple Music, một capsule kính nổi ở chân cột nội dung: là phần tử cuối của `SidebarInset` với `sticky bottom-3 mt-auto`, rộng tối đa `max-w-2xl` (672px, AM 668px), nên tự canh giữa giữa sidebar và queue dock mà không cần JS; sidebar và queue cao hết màn hình. Chiều cao thật đo vào `--player-bar-height` cho những thứ phải né nó: toast, nút cuộn nhanh, thanh thao tác hàng loạt, và `scroll-margin` của vùng nội dung (xem cột giữa).
- **Breakpoint chính 1280px (`WIDE_LAYOUT_QUERY`, bằng `xl`)**: từ 1280px trở lên đủ 3 cột. Dưới 1280px sidebar thu về icon (vẫn mở tay được, giữ nguyên đến khi vượt lại breakpoint) và queue thành `Sheet` trượt từ phải, mở bằng nút Queue trên PlayerBar. Dưới 768px sidebar là `Sheet` của shadcn.
- **Header dính là `@container`** để luôn nằm trên một hàng thay vì wrap khi cột giữa hẹp (mở queue, sidebar mở): nhãn sort và Grid / List chỉ hiện khi header rộng từ `@6xl` (72rem), nhãn + Local Audio / + YouTube từ `@4xl` (56rem); hẹp hơn chỉ còn icon, tên vẫn nằm ở `aria-label` và tooltip `title`.
- **Nhịp khoảng cách**: thang 4px; dùng `gap-*` thay cho `space-*`.
- **Cuộn**: trang (thư viện) là vùng cuộn chính. Vùng cuộn riêng (danh sách playlist trong sidebar, list queue) dùng `overscroll-contain`, nên cuộn quá đáy không kéo thư viện chạy theo. Dưới chuột/trackpad (`pointer-fine`) trang không rubber-band (`overscroll-none` trên `html`); màn cảm ứng giữ mặc định để còn kéo-để-tải-lại.

## Elevation & Depth

Giao diện áp dụng triệt để mô hình **Tonal Layering** (Phân tầng theo sắc độ nền) thay vì phụ thuộc vào bóng đổ:
- Lớp 0 (Canvas Base): `#100F0F` (Flexoki Black) / `#FFFCF0` (Flexoki Paper) - Nền sâu nhất của cửa sổ ứng dụng.
- Lớp 1 (Card & Drawer): `#1C1B1A` (Flexoki 950) / `#F2F0E5` (Flexoki 50) - Bề mặt nâng nhẹ cho thẻ bài hát và ngăn kéo hàng đợi.
- Lớp 2 (Hover & Inset): `#282726` (Flexoki 900) / `#E6E4D9` (Flexoki 100) - Nền chip (`secondary` / `muted`), trạng thái hover nhẹ và đường viền phân tách 1px (`border`).
- Lớp 3 (Active & Input): `#343331` (Flexoki 850) / `#DAD8CE` (Flexoki 150) - Trạng thái bấm giữ, nền `accent` và viền ô nhập (`input`).

### Shadow Vocabulary
- **Capsule nổi** (`shadow-xl` + `border` + kính `backdrop-blur-lg backdrop-saturate-200`): PlayerBar trôi trên chân cột nội dung, nội dung cuộn bên dưới lớp kính.
- **Overlay** (bóng có sẵn của shadcn: `shadow-md` cho menu, `shadow-lg` cho Sheet): Không tự đặt bóng riêng cho hộp thoại hay menu.
- **Tile không đổ bóng**: Tile được chọn hoặc là đích thả dùng vòng `ring-2 ring-primary ring-offset-2`, không dùng glow màu.

### Named Rules
**The Crisp Border Rule.** Mọi thành phần phân tầng đều sử dụng viền 1px màu `border` (`#282726`) có độ mờ rõ ràng thay cho việc đổ bóng lớn. Cạnh viền phải dứt khoát và sắc nét.

## Shapes

- **Bo góc lớn**: `14px` (`0.875rem` - `rounded-xl`) cho các container lớn (TrackCard, Modal, Waveform Card).
- **Bo góc chuẩn**: `10px` (`0.625rem` - `rounded-lg`) cho thumbnail và card giao diện.
- **Bo góc trung bình**: `8px` (`0.5rem` - `rounded-md`) cho ô nhập liệu Input và nút bấm mặc định.
- **Bo góc nhỏ**: `6px` (`0.375rem` - `rounded-sm`) cho các nút bấm phụ và chip badge.
- **Bo tròn tuyệt đối (Pill)**: `9999px` (`rounded-full`) dành riêng cho nút Play/Pause tròn, nút hành động icon và các dải vạch màu định danh lát cắt.

## Components

### Buttons
- Chỉ dùng shadcn `Button` với `variant` (`default`, `secondary`, `outline`, `ghost`, `destructive`, `link`) và `size` (`xs`, `sm`, `default`, `lg`, `icon-xs`, `icon-sm`, `icon`, `icon-lg`). Không ghi đè màu, chữ, padding, bo góc hay hiệu ứng qua `className`; chỉ thêm class layout (`max-w-*`, `flex-1`, …).
- Icon trong nút mang `data-icon="inline-start"` / `"inline-end"` và không gắn class kích thước. Nút chỉ có icon phải có `aria-label`. Vùng chạm tối thiểu 24px (`icon-sm`); `icon-xs` (20px) không dùng cho thao tác chính.
- Nhóm nút liền nhau dùng `ButtonGroup`; chọn 1 trong vài phương án dùng `ToggleGroup`; nút bật/tắt dùng `Toggle`. Ngoại lệ: Shuffle / Loop track trong PlayerBar và Loop queue là `Button` đổi `variant` kèm `aria-pressed`, vì `Toggle` không có cỡ icon vuông 32px như hàng nút transport.
- Nút đã ở đầu/cuối phạm vi (cuộn lên đầu trang, chuyển mục lên trên cùng) dùng `disabled`, không tự làm mờ bằng `opacity`.
- Focus bàn phím luôn là vòng `ring-2 ring-ring` trên `focus-visible` (`ring-inset` với vùng cuộn).

### Playlist Header (`PlaylistHeader`)
- Theo header playlist của Apple Music: artwork vuông lớn (`rounded-lg`, 270px từ `lg`), bên phải là tên `text-2xl font-bold` (26px), dòng chi tiết nhỏ `text-2xs font-semibold text-muted-foreground` (số mục, số lát cắt, tổng thời lượng; như dòng "Updated …" của Apple), rồi Play và Shuffle cùng là nút `default` (như hai nút màu chủ đạo của Apple Music trên macOS) và nút "…". Không có nhãn "Playlist" phía trên tên.
- Sub-playlist có `Breadcrumb` về playlist cha phía trên tên; mix có dòng nguồn (`Combine`, `text-flexoki-magenta`) và nút Edit sources dưới dòng chi tiết.
- Nút đổi tên (bút chì) cạnh tên chỉ hiện khi hover / focus (`REVEAL_ON_HOVER`), vì đổi tên cũng có trong menu "…".
- Dưới `sm`, header xếp dọc và căn giữa (artwork, tên, chi tiết, các nút) như Apple Music trên điện thoại.

### Song Table (List view)
- `PlaylistTableView` theo hàng bài hát của Apple Music (đo trên music.apple.com): hàng ảo hoá cao 54px, artwork vuông 40px, tiêu đề `text-xs` (13px) chữ thường, cột Artist riêng, cột loại, thời lượng `tabular-nums` (không dùng font mono). Header cột `text-2xs font-semibold`, không có viền dưới.
- Giữa các hàng là đường kẻ mảnh ở mép trên mỗi hàng thay cho sọc zebra (utility `row-divider` trong `index.css`, gắn trên wrapper của virtualizer, dùng chung với queue). Hàng đang tô nền (hover hoặc đang mở menu nếu phát được: `data-tint="hover"`; đang chọn hoặc là đích thả: `data-tint="on"`) ẩn đường kẻ ở cả hai phía, để nền đọc thành một khối bo tròn như Apple Music. Trong lúc kéo để sắp xếp, các hàng trượt sang bên còn wrapper thì đứng yên, nên bảng tạm bỏ hết đường kẻ.
- Không có cột số thứ tự: Apple Music không đánh số hàng có artwork. Trạng thái phát nằm trên artwork. Hover một hàng phát được thì artwork tối đi (`bg-black/45`) dưới glyph Play, hoặc Pause nếu hàng đang phát. Hàng đang phát hiện equalizer trên artwork và tiêu đề màu `primary` (theo `aria-current` của hàng), không tô nền. Tiêu đề màu `primary` nghĩa là đang phát, giống tile grid và queue.
- Cột loại như cột Album của Apple Music: full track (mặc định) là chữ thường `text-muted-foreground`, chỉ lát cắt mới có `Badge` vàng kèm khoảng thời gian, để lát cắt nổi bật (Slices Over Full Tracks).
- Các cột theo độ rộng của **chính bảng** (container query, `@container` gắn trên `role="table"`), không theo viewport: cạnh sidebar và queue, viewport rộng nhưng bảng thì hẹp. Như Apple Music bỏ cột Album rồi Artist khi cửa sổ hẹp lại, cột Artist hiện từ `@2xl` (42rem), cột thứ 3 (nhãn loại / bài gốc / số slice) từ `@4xl` (56rem). Khi chưa có cột Artist, nghệ sĩ nằm ở dòng phụ dưới tiêu đề. Lát cắt luôn có dòng phụ "From: …"; riêng danh sách Slices chỉ hiện dòng này khi cột bài gốc bị ẩn.
- Cột đầu chỉ chứa `Checkbox` để chọn nhiều: hiện khi hover / focus và giữ nguyên khi đang chọn. Điện thoại không hover được nên chỉ hiện khi đang chọn. Ô ở header có trạng thái indeterminate.
- Như Apple Music, hàng chỉ có nút "…" (`RowActionsMenu`, luôn hiện). Ở mọi độ rộng, các hành động của hàng nằm trong menu đó: Select, Move up / Move down (chỉ khi playlist sắp xếp thủ công), Open Slice Studio (hoặc Retry với bài tải lỗi), Add to Playlist, Copy YouTube link, xoá. Đang mở menu thì hàng giữ nền hover, như context menu của macOS. Grip kéo thả của playlist nằm cạnh nút "…" và chỉ hiện khi hover / focus (`REVEAL_ON_HOVER`), như tay nắm sắp xếp bên phải hàng của iOS Music; bàn phím vẫn sắp xếp bằng phím mũi tên trên grip. Cột này không có nhãn hiển thị: header "Actions" là `sr-only`, chỉ dành cho screen reader. Trạng thái đang tải dùng `Badge` + `Spinner`.

### Grid Tiles (`MediaTile`)
- TrackCard, SliceCard và PlaylistItemCard dùng chung `MediaTile` và `useGuardedPlayToggle`: artwork 16:9 bo góc, bên dưới là tiêu đề `text-xs` chữ thường (như tile của Apple Music), phụ đề `text-xs text-muted-foreground` và meta `text-2xs tabular-nums` (không dùng font mono), bên phải là nút Studio và "…", chỉ hiện khi hover / focus như Apple Music.
- Bấm artwork để phát/tạm dừng; khi đang chọn nhiều thì bấm để chọn. Checkbox góc trái trên và các nút trên artwork hiện khi hover qua `REVEAL_ON_HOVER` (chỉ ẩn trên thiết bị có chuột; màn cảm ứng luôn hiện). Menu mở từ bên trong (`has-data-popup-open`) giữ chúng hiện, vì khi chuột đã vào popup thì tile hết hover. Với thành phần shadcn, `REVEAL_ON_HOVER` đặt ở `div` bọc ngoài chứ không đặt thẳng lên `Button`.
- Lớp phủ trạng thái (queued / downloading / failed) che artwork; vạch màu lát cắt `bg-(--slice-color)` nằm ở chân artwork; `Badge` "Playing" khi đang phát.
- Lưới ảo hoá, mỗi cột tối thiểu 240px, khe 20px (`GRID_GAP`). Tile playlist (`PlaylistGrid`) vuông, tên `text-xs` chữ thường và số mục `tabular-nums`: bấm cover để mở, Play / Shuffle hiện khi hover, tile viền đứt cho New Playlist / Mix Playlists.
- Lần tải đầu hiện `LibrarySkeleton` có hình theo chế độ xem hiện tại (hàng hoặc tile) và đúng một `role="status"`.

### Forms & Dialogs
- Hộp thoại dùng Base UI `Dialog` / `AlertDialog` qua shadcn (`Modal`, `ConfirmModal`); ngăn kéo dùng `Sheet`.
- Form dùng `FieldGroup` + `Field` + `FieldLabel`: mọi ô nhập có nhãn hiển thị, lỗi hiện bằng `FieldError` kèm `aria-invalid`. Danh sách lựa chọn có sẵn dùng `Select` (Base UI, prop `items`), nhập nhiều dòng dùng `Textarea`.
- Chọn 1 trong vài phương án có mô tả dùng `RadioGroup` dạng choice card (`FieldLabel` bọc `Field`); chọn nhiều dùng `Checkbox` dạng choice card. Danh sách thao tác áp dụng ngay (ví dụ chọn ảnh bìa) dùng `Item` render thành `button`, đánh dấu mục hiện tại bằng `aria-current` + dấu check; không dùng radio vì phím mũi tên sẽ áp dụng ngay.
- Tiến trình dùng `Progress`, đang chờ dùng `Spinner`, cảnh báo dùng `Alert`, vùng trống / dropzone dùng `Empty` (dropzone là `div` viền đứt bọc `Empty`), nhiều phần nội dung dùng `Tabs`.

### Navigation & PlayerBar
- **PlayerBar**: capsule `rounded-full` cao 56px (`h-14`), nền `bg-card/70` + `backdrop-blur-lg backdrop-saturate-200` + `shadow-xl`, là landmark `<section aria-label="Player">`. Trái là cụm transport (Shuffle, Previous, Play/Pause, Next, Loop track; `Button` `icon-lg`, nút đang bật dùng `secondary` + glyph `text-primary`). Giữa là "LCD" (`bg-muted/50`): artwork 34px có vạch màu lát cắt, tên bài Semi-bold bấm được để nhảy tới bài, dòng phụ thay cho "Artist — Album" (lát cắt hiện tên lát cắt màu xanh, khoảng thời gian nằm trong tooltip; bài đầy đủ hiện nghệ sĩ), chip "đang phát từ" (`Button` `secondary` `xs`) bên phải, và seek bar lát cắt ở đáy kèm `vị trí / độ dài`. Phải là menu "…" (`DropdownMenu`: các playlist chứa bài, bấm để mở; thay cho dãy chip playlist cũ), nút loa mở `Popover` âm lượng riêng của bài (nút Mute + slider), và nút Queue (glyph `text-primary` khi queue mở). Cột hẹp hơn một hàng (container query `@xl`, 576px) thì capsule thành card `rounded-3xl` hai hàng: LCD ở trên, nút ở dưới; lúc chưa phát gì capsule vẫn giữ một hàng.
- **Queue**: hàng theo "Up Next" của Apple Music: artwork 40px sát mép trái, tên `text-xs` chữ thường (bài đang phát màu `primary`), dòng phụ `text-xs text-muted-foreground`, thời lượng `tabular-nums` bên phải, đường kẻ mảnh giữa các hàng (`row-divider`, như bảng). Với chuột, thời lượng nhường chỗ cho tay cầm kéo và nút xoá khi hover / focus (hai lớp chồng trong cùng một ô grid, nên tên không bị chừa chỗ cho nút); màn cảm ứng không hover được nên hiện cả hai cạnh nhau, kèm nút lên/xuống (`Button` `ghost` `icon-sm`, chỉ hiện trên thiết bị cảm ứng hoặc màn hẹp) ở đầu hàng.
- **Cuộn nhanh**: `ButtonGroup` dọc gồm 2 `Button` `outline`; mỗi nút `disabled` khi trang đã ở đúng đầu đó.

### Feedback & Errors
- Lỗi nằm cạnh chỗ nó xảy ra: các dialog (New Playlist, Mix Playlists, YouTube, Import, Backup) và Slice Studio tự hiện lỗi bên trong.
- Thay đổi không còn chỗ nào để báo (menu đã đóng, cập nhật lạc quan đã lặng lẽ rollback) gửi qua `sendChange` (`lib/sendChange.ts`). Lỗi hiện `toast` của shadcn: project là Base UI nên dùng Base UI Toast, không dùng Sonner (Sonner dành cho Radix). Toast lỗi có `type: "error"`, `priority: "high"` (screen reader đọc ngay), `timeout: 0` (ở lại tới khi tắt). Mỗi loại thay đổi chỉ có 1 toast (`id` cố định), thất bại lặp lại thì cập nhật toast đó. Chi tiết ghi vào System Logs bằng tiếng Anh.
- Chỉ báo khi chính request thất bại, không báo khi phần xử lý sau một response thành công bị lỗi. Lỗi mạng và 502/503/504 (proxy không tới được server) đều là "Can't reach the server".
- Giọng theo copy sẵn có: tiêu đề "Failed to …" / "Không thể …", mô tả nói cách xử lý.
- `Toaster` nằm trong `AppShell`; viewport đặt trên capsule PlayerBar (`bottom` = `--player-bar-height` + 1rem) để không che nút điều khiển.
- Toast là dialog không modal (`aria-modal="false"`), nên `isDialogOpen` bỏ qua nó: toast lỗi đang mở không được khoá phím tắt (Space, Q, F2, tìm kiếm). Người dùng bàn phím tới toast bằng F6 (Base UI), có ghi trong bảng phím tắt.
- Thử tải lại: tải chạy rồi lại thất bại thì server ghi lý do vào track và track tự hiện lỗi, không toast. Mọi lỗi khác của request thử lại đều báo bằng toast.

### Signature Component: Slice Studio Waveform Deck
- Khung hiển thị sóng âm WaveSurfer với nền `#100F0F`, sóng màu xám `#403E3C`, dải tiến trình đỏ `#D14D41`, con trỏ hồng `#CE5D97`.
- Các vùng phân đoạn (Regions) được gán 8 màu ngẫu nhiên từ bảng màu Flexoki đầy đủ (Xanh dương, Lam ngọc, Lục, Vàng, Cam, Tím, Đỏ, Hồng), hiển thị viền kéo thả hai đầu trực quan.

## Do's and Don'ts

### Do:
- **Do** sử dụng mã màu Flexoki đã được định nghĩa trong `index.css` khi viết component mới.
- **Do** dùng `tabular-nums` cho mọi hiển thị thời gian âm thanh (`0:00`) và số đếm; `JetBrains Mono` chỉ cho ngữ cảnh kỹ thuật (Slice Studio, log, keycap, URL / tên file).
- **Do** viết số đếm theo cách ngôn ngữ đang chọn viết số (`1,236` tiếng Anh, `1.236` tiếng Việt): trong bản dịch dùng `{{count, number}}` (cả `total`, `filtered`, `current`, `position`…), số đứng riêng như badge thì qua `useFormatNumber()`. Mã HTTP, phần trăm và số thứ tự hàng thì để nguyên.
- **Do** giữ capsule PlayerBar dính chân cột nội dung (`sticky bottom-3`) để người dùng có thể thao tác nhạc từ bất kỳ đâu.
- **Do** áp dụng `pointer-events-none` và `user-select: none` cho các thành phần kéo thả thumbnail để tránh lỗi kéo nhầm hình ảnh của trình duyệt.
- **Do** gán màu lát cắt (`activeSegment.color`) trực tiếp vào vạch màu thumbnail và thanh tiến trình để tạo dấu ấn thị giác nhận diện đoạn nhạc.
- **Do** dùng `TrackThumbnail size="small"` (hoặc `PlaylistCover thumbnailSize="small"`) cho ô ảnh nhỏ: hàng bảng, queue, PlayerBar, danh sách. Với YouTube nó tải bản 320px `mqdefault` thay vì `maxresdefault` 1280px (nhẹ hơn khoảng 8 lần), lỗi thì quay về ảnh gốc. Tile grid và header playlist giữ ảnh lớn. Ảnh bìa của file local (thường 3000px, ~2,8MB) luôn đi qua `/api/thumbs/…?size=small|large`: server thu nhỏ bằng ffmpeg về 192px hoặc 640px (không phóng to), làm 1 lần rồi dùng lại tới khi ảnh bìa đổi, lưu ở `data/cache/thumbs-sized` (dữ liệu dẫn xuất, không vào backup).

### Don't:
- **Don't** sử dụng nền trắng tinh (`#FFFFFF`) hoặc xám lạnh thông thường; toàn bộ bề mặt phải thuộc 14 nấc màu Base Flexoki ấm.
- **Don't** sử dụng gradient màu bóng bẩy hoặc chữ gradient rườm rà.
- **Don't** tự dựng component UI mà shadcn đã có: thêm bản Base UI bằng CLI (`bunx --bun shadcn@latest add <x>`). File trong `ui/` giữ nguyên như CLI sinh ra; sửa đổi cục bộ (checkbox, slider, badge, item, dropdown-menu, toast) commit riêng kèm lý do. Kéo thả vẫn dùng API DOM (`draggable`, `PointerEvent`), không thêm thư viện kéo thả.
- **Don't** dùng inline style cho giá trị động; đặt CSS variable rồi dùng class (`bg-(--slice-color)`, `h-(--bar-height)`).
- **Don't** dùng `text-primary` cho chữ chỉ mang thông tin; màu nhấn dành cho hành động và trạng thái đang phát.
- **Don't** làm mất đi tính xúc giác của thanh tiến trình: khi kéo tua, phải dừng phát tạm thời và cập nhật mượt mà theo từng pixel.
