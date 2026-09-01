# Phase 1 — Docker Fundamentals

## 🎯 Mục tiêu

Mục tiêu của phase này là containerize CloudShop API bằng Docker và hiểu luồng từ source code đến container đang chạy.

```text
Source Code
    ↓
Dockerfile
    ↓
docker build
    ↓
Docker Image
    ↓
docker run
    ↓
Container
```

---

## 1. Docker giải quyết vấn đề gì?

Một application thông thường phụ thuộc vào môi trường chạy:

```text
Application
├── Node.js version
├── Dependencies
├── Runtime
└── Configuration
```

Nếu môi trường Development, CI và Production khác nhau, application có thể hoạt động không nhất quán.

Docker đóng gói application và runtime thành một Docker image.

```text
Source Code
     +
Node.js Runtime
     +
Dependencies
     ↓
Docker Image
```

Image này có thể được sử dụng nhất quán qua nhiều môi trường:

```text
Developer
    ↓
CI
    ↓
Amazon ECR
    ↓
ECS
```

---

## 2. Dockerfile là gì?

`Dockerfile` là tập hợp các instruction dùng để build Docker image.

CloudShop sử dụng:

```text
Dockerfile
    ↓
docker build
    ↓
cloudshop-api image
```

Một Dockerfile thường gồm các thành phần:

```dockerfile
FROM ...
WORKDIR ...
COPY ...
RUN ...
EXPOSE ...
CMD ...
```

### FROM

Xác định base image.

Ví dụ:

```dockerfile
FROM node:20-alpine
```

Tư duy:

```text
Node.js Runtime
      ↓
CloudShop Source Code
      ↓
CloudShop Image
```

### WORKDIR

Thiết lập working directory bên trong image.

```dockerfile
WORKDIR /app
```

Các command tiếp theo sẽ làm việc trong:

```text
/app
```

### COPY

Copy file từ build context vào image.

Ví dụ:

```dockerfile
COPY package*.json ./
```

sau đó:

```dockerfile
COPY . .
```

### RUN

Chạy command trong quá trình build image.

Ví dụ:

```dockerfile
RUN npm ci --omit=dev
```

Dependencies được cài vào image trong quá trình build.

### EXPOSE

Mô tả port application sử dụng:

```dockerfile
EXPOSE 3000
```

`EXPOSE` không tự động publish port ra host.

### CMD

Command mặc định khi container khởi động.

Ví dụ:

```dockerfile
CMD ["node", "src/server.js"]
```

---

## 3. Build Docker Image

Command:

```bash
docker build -t cloudshop-api:v1 .
```

Phân tích:

```text
docker build
│
├── -t
│    └── đặt tên/tag image
│
├── cloudshop-api
│    └── repository/name
│
├── v1
│    └── tag
│
└── .
     └── build context
```

Kết quả:

```text
Dockerfile
    ↓
docker build
    ↓
cloudshop-api:v1
```

Kiểm tra:

```bash
docker images
```

---

## 4. Image và Container khác nhau thế nào?

Docker Image là template bất biến dùng để tạo container.

Docker Container là instance đang chạy của image.

```text
Docker Image
     │
     ├── Container A
     ├── Container B
     └── Container C
```

Có thể hiểu:

```text
Image
= bản thiết kế

Container
= instance được tạo từ bản thiết kế
```

---

## 5. Chạy Container

Ví dụ:

```bash
docker run cloudshop-api:v1
```

Nếu cần publish port:

```bash
docker run -p 3000:3000 cloudshop-api:v1
```

Mapping:

```text
Host
:3000
  │
  ▼
Container
:3000
```

Request:

```text
localhost:3000
      ↓
Host port 3000
      ↓
Container port 3000
      ↓
CloudShop API
```

---

## 6. Các command quan trọng

Xem images:

```bash
docker images
```

Xem container đang chạy:

```bash
docker ps
```

Xem tất cả container:

```bash
docker ps -a
```

Xem logs:

```bash
docker logs <container>
```

Dừng container:

```bash
docker stop <container>
```

Xóa container:

```bash
docker rm <container>
```

Xóa image:

```bash
docker rmi <image>
```

Build lại image:

```bash
docker build -t cloudshop-api:v1 .
```

---

## 7. Tư duy Debug Docker

Khi container không chạy, không sửa ngẫu nhiên.

Đi theo flow:

```text
Dockerfile build được?
       ↓
Image tồn tại?
       ↓
Container start được?
       ↓
Process bên trong chạy?
       ↓
Port đúng?
       ↓
Application trả response?
```

Các command thường dùng:

```bash
docker ps -a
docker logs <container>
docker inspect <container>
```

---

## 🧠 Kiến thức cốt lõi cần note

```text
Dockerfile
= hướng dẫn build image

Docker Image
= artifact/template

Container
= running instance của image

docker build
= Dockerfile → Image

docker run
= Image → Container

EXPOSE
= mô tả container port
≠ publish port

-p 3000:3000
= Host Port : Container Port
```

Flow cần nhớ:

```text
Source Code
    ↓
Dockerfile
    ↓
docker build
    ↓
Docker Image
    ↓
docker run
    ↓
Container
```

---

## 📌 CloudShop Application

Trong CloudShop:

```text
Node.js Source Code
       ↓
Dockerfile
       ↓
cloudshop-api image
       ↓
CloudShop API Container
       ↓
Port 3000
```

Docker image này sau này sẽ tiếp tục đi qua:

```text
GitHub Actions
      ↓
Amazon ECR
      ↓
Amazon ECS Fargate
```