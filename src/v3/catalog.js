// The shop's PPF price list (storedetailing.vn/dan-ppf-o-to-tphcm, listed 16/10/2026): full-body exterior packages by
// film and car size, in VND. Update prices here; the product picker and the comparison table are built from it.

export const UPDATED = '16/10/2026';

export const CONTACT = {
  hotline: '0378 78 88 98',
  tel: 'tel:0378788898',
  zalo: 'https://zalo.me/storedetailingvn',
};

// car sizes: the price columns (l, the five-seat SUV, sells the most)
export const SIZES = [
  { id: 'm', name: 'Sedan', sub: '4–5 chỗ', short: 'Sedan 4–5 chỗ', cars: 'VF3, VF5, Mazda 3, Civic, Vios, C-Class, BMW 3…' },
  { id: 'l', name: 'SUV', sub: '5 chỗ', short: 'SUV 5 chỗ', cars: 'VF6, VF7, CX-5, CR-V, Tucson, GLC, X3…' },
  { id: 'xl', name: 'SUV 7 chỗ', sub: 'MPV, cỡ lớn', short: 'SUV 7 chỗ, MPV', cars: 'VF8, VF9, Santa Fe, Everest, Carnival, Prado…' },
];

const M = 1e6;
const film = (code, mil, years, [m, l, xl], note, badge = '') => ({ code, mil, years, price: { m: m * M, l: l * M, xl: xl * M }, note, badge });

export const BRANDS = [
  {
    id: 'zappa',
    name: 'Zappa',
    full: 'Phim PPF Zappa',
    tier: 'Tầm trung đến cao cấp',
    warranty: '5–10 năm',
    about: 'Dải sản phẩm rộng nhất: sáu mã, từ gói chạy phố tới 1398 Pro dày 13.5 mil. Xưởng có sẵn kho rập CNC Zappa cho hầu hết dòng xe phổ biến, cắt trên chính chiếc máy ZAPPA M-1600 bạn vừa thấy ở trên.',
    fit: 'Chủ xe muốn nhiều bậc lựa chọn để cân đối ngân sách.',
    link: 'https://storedetailing.vn/kien-thuc/dan-ppf-zappa',
    films: [
      film('1368', 7.5, 5, [18.9, 20.9, 22.9], 'Gói tiết kiệm cho xe chạy phố, tự phục hồi xước dăm nhẹ.', 'Tiết kiệm'),
      film('1378', 8.5, 5, [25, 27, 28.9], 'Dày hơn 1368, cân bằng giữa chi phí và độ bền.'),
      film('1388', 9.5, 8, [35, 37, 38.9], 'Mã bán chạy nhất, chống đá dăm tốt khi đi cao tốc.', 'Bán chạy'),
      film('1388 Pro', 10.5, 8, [46.9, 50.9, 53.9], 'Cho SUV, bán tải hay đi đường xấu, chịu cọ quẹt tốt.'),
      film('1398', 12.5, 10, [75, 80, 85], 'Màng dày cho xe mới, bảo vệ tối đa.'),
      film('1398 Pro', 13.5, 10, [86, 93, 99], 'Dày nhất dải Zappa, lựa chọn cao nhất của hãng.', 'Dày nhất'),
    ],
  },
  {
    id: '3m',
    name: '3M',
    full: 'Phim PPF 3M Scotchgard Pro',
    tier: 'Cao cấp · Mỹ',
    warranty: '5–10 năm',
    about: 'Thương hiệu Mỹ gắn liền với màng phim bảo vệ sơn. Scotchgard Pro nổi tiếng với lớp keo sạch, độ bóng sâu và bảo hành điện tử chính hãng; bốn mã tăng dần độ dày và độ bóng, từ 3M 50 tới 3M 200.',
    fit: 'Xe sang, xe mới, chủ xe đặt thương hiệu và độ bền lên trên hết.',
    link: 'https://storedetailing.vn/kien-thuc/dan-ppf-3m',
    films: [
      film('50 Gloss', 7.3, 5, [38, 38, 44], 'Bước vào 3M dễ nhất, keo sạch, an toàn cho sơn zin.'),
      film('100 Gloss', 7.5, 7, [69, 69, 76], 'Lớp top-coat kháng hoá chất, tự phục hồi xước nhẹ.'),
      film('150 Gloss', 7.5, 7, [85, 85, 92], 'Bóng gương hơn, nước trượt khỏi bề mặt nhanh hơn.'),
      film('200 Gloss', 7.9, 10, [102, 102, 110], 'Đầu bảng của 3M, dành cho xe sang và siêu xe.', 'Đầu bảng'),
    ],
  },
  {
    id: 'teckwrap',
    name: 'Teckwrap',
    full: 'Phim PPF Teckwrap',
    tier: 'Tầm trung',
    warranty: '4–7 năm',
    about: 'Bảy mã ở phân khúc tầm trung, khác nhau ở độ dày và thời hạn bảo hành, để bạn chọn đúng mức mình cần thay vì trả tiền cho dòng cao nhất.',
    fit: 'Xe gia đình, xe phổ thông cần bảo vệ tốt với chi phí vừa phải.',
    link: 'https://storedetailing.vn/kien-thuc/dan-ppf-teckwrap-trong-suot-cho-hyundai-tucson-tai-store-detailing',
    films: [
      film('V75', 7.5, 4, [25, 25, 26], 'Mức giá dễ tiếp cận nhất của Teckwrap.'),
      film('X75', 7.5, 5, [28, 28, 30], 'Lựa chọn cân bằng cho xe gia đình.'),
      film('X85', 8.5, 5, [33, 33, 35], 'Màng dày hơn, chống đá dăm tốt hơn.'),
      film('E65', 6.5, 5, [33, 33, 36], 'Màng mỏng 6.5 mil, bảo hành 5 năm.'),
      film('E75', 7.5, 5, [34, 34, 36], 'Bản 7.5 mil của dòng E.'),
      film('G75', 7.5, 6, [35, 35, 38], 'Bảo hành dài hơn: 6 năm.'),
      film('S75', 7.5, 7, [42, 42, 45], 'Đầu bảng Teckwrap, bảo hành 7 năm.', 'Đầu bảng'),
    ],
  },
  {
    id: 'felix',
    name: 'Felix',
    full: 'Phim PPF Felix TPU',
    tier: 'Phổ thông',
    warranty: '3 năm',
    about: 'Lớp bảo vệ TPU cơ bản trước xước dăm, phân chim và nhựa cây với chi phí thấp nhất, hợp xe chạy dịch vụ hoặc xe cũ muốn giữ lớp sơn hiện tại.',
    fit: 'Chủ xe cần lớp bảo vệ cơ bản với chi phí thấp nhất.',
    link: 'https://storedetailing.vn/kien-thuc/goi-dan-ppf-sieu-tiet-kiem',
    films: [
      film('TPU', 7.5, 3, [18, 20, 22], 'Lớp bảo vệ sơn TPU cơ bản, chi phí thấp nhất.'),
    ],
  },
];
