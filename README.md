# son-wow-3D

Website giới thiệu phim bảo vệ sơn PPF cho **Storedetailing**: một chiếc xe 3D trong studio tối kể toàn bộ câu chuyện khi cuộn trang (soi lớp phim, phủ phim, thử nghiệm đá văng, tự phục hồi, 5 lớp phim tách ra từ capo, so sánh trước/sau).

Vite + Three.js + GSAP ScrollTrigger + Lenis. Mô hình 3D dựng/xuất từ Blender (`blender/`).

## Chạy local

```bash
npm install
npm run dev
```

## Deploy (Docker, cổng 3000)

Image build site tĩnh rồi phục vụ bằng nginx trên cổng **3000**:

```bash
docker build -t son-wow-3d .
docker run -p 3000:3000 son-wow-3d
```

Với Dokploy: tạo Application từ repo này, Build Type = **Dockerfile**, port **3000**, bật Auto Deploy để mỗi lần push lên `main` tự build lại.

## Ghi chú

- Mô hình xe: “Fictional supercar – V12 Goblin” của ollitei, giấy phép CC BY 4.0 (ghi nguồn ở chân trang, cần giữ nguyên).
- Nội dung còn chờ xưởng cung cấp: link Zalo / hotline / bản đồ, giá các gói, xác nhận thông số “đến 10 năm” và “~0,2 mm”.
