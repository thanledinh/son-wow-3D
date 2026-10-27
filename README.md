# son-wow-3D

Website giới thiệu phim bảo vệ sơn PPF cho **Storedetailing**: một câu chuyện 3D kể bằng cách cuộn trang. Chiếc xe trong phần mềm dựng khuôn trên laptop, bộ khuôn gửi sang máy cắt ZAPPA M-1600, máy cắt cả bộ phim một lượt, các mảnh phim bay lên phủ kín xe, bề mặt bóng sâu, vết xước xoáy tự phục hồi dưới nắng, rồi 5 lớp phim tách ra.

Một trang duy nhất (`index.html`, code ở `src/v3/`). Vite + Three.js + GSAP + Lenis. Mô hình 3D dựng/xuất từ Blender (`blender/`).

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

Với Dokploy: tạo Application từ repo này, Build Type = **Dockerfile**, port **3000**, bật Auto Deploy để mỗi lần push lên `main` tự build lại. Các địa chỉ cũ `/v2`, `/v3` chuyển về `/`.

## Ghi chú

- Mô hình xe: “Porsche 911” (911 Targa 4S 2021) của Outlaw Games, giấy phép CC BY-NC 4.0; ánh sáng môi trường “Trinitatis Church” của Unity Technologies (CC0). Ghi nguồn ở chân trang, cần giữ nguyên.
- Nội dung còn chờ xưởng cung cấp: link đặt lịch (Zalo / hotline / bản đồ).
