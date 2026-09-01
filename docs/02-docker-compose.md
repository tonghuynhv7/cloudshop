# Phase 2 — Docker Compose

## 🎯 Mục tiêu

Mục tiêu của phase này là chạy toàn bộ CloudShop local stack bằng Docker Compose.

CloudShop gồm 4 service:

```text
Client
  ↓
Nginx
  ↓
CloudShop API
  ├── PostgreSQL
  └── Redis
```

Thay vì chạy từng container thủ công bằng nhiều lệnh `docker run`, Docker Compose cho phép định nghĩa toàn bộ hệ thống trong:

```text
compose.yaml
```

Sau đó khởi động bằng:

```bash
docker compose up -d --build
```

---

# 1. Tại sao cần Docker Compose?

Nếu không có Docker Compose, cần chạy từng container riêng:

```text
docker run postgres...
docker run redis...
docker run cloudshop-api...
docker run nginx...
```

Ngoài ra còn phải tự cấu hình:

```text
Network
Volume
Environment Variables
Port Mapping
Dependencies
Health Checks
```

Khi số lượng service tăng, việc quản lý bằng `docker run` trở nên phức tạp.

Docker Compose cho phép mô tả toàn bộ stack:

```text
compose.yaml
     │
     ├── nginx
     ├── api
     ├── postgres
     ├── redis
     ├── network
     └── volume
```

---

# 2. CloudShop Local Architecture

```text
                        HOST
                          │
                          │ :80
                          ▼
                  ┌───────────────┐
                  │     Nginx     │
                  │      :80      │
                  └───────┬───────┘
                          │
                          │ api:3000
                          ▼
                  ┌───────────────┐
                  │ CloudShop API │
                  │     :3000     │
                  └───────┬───────┘
                          │
                  ┌───────┴────────┐
                  │                │
                  ▼                ▼
           ┌────────────┐    ┌────────────┐
           │ PostgreSQL │    │   Redis    │
           │   :5432    │    │   :6379    │
           └────────────┘    └────────────┘

              Docker Network: cloudshop-net
```

Chỉ Nginx cần nhận traffic từ host.

Các service còn lại giao tiếp thông qua Docker network.

---

# 3. Services

Trong Compose:

```yaml
services:
```

dùng để khai báo các container/service của application.

CloudShop có:

```text
services
├── api
├── postgres
├── redis
└── nginx
```

Mỗi service có nhiệm vụ riêng.

---

# 4. API Service

CloudShop API được build từ Dockerfile:

```yaml
api:
  build:
    context: .
    dockerfile: Dockerfile
```

Flow:

```text
compose.yaml
    ↓
build
    ↓
Dockerfile
    ↓
CloudShop API Image
    ↓
API Container
```

`context: .` nghĩa là thư mục hiện tại được sử dụng làm Docker build context.

`dockerfile: Dockerfile` xác định Dockerfile dùng để build API image.

---

# 5. Environment Variables

API cần biết địa chỉ của PostgreSQL và Redis.

Ví dụ:

```yaml
environment:
  PORT: 3000

  DB_HOST: postgres
  DB_PORT: 5432
  DB_NAME: cloudshop
  DB_USER: clouduser
  DB_PASSWORD: cloudpass

  REDIS_HOST: redis
  REDIS_PORT: 6379
```

Điểm quan trọng:

```text
DB_HOST=postgres
```

không phải:

```text
DB_HOST=localhost
```

Tương tự:

```text
REDIS_HOST=redis
```

---

# 6. Tại sao không dùng localhost?

Trong container API:

```text
localhost
```

có nghĩa là:

```text
chính container API
```

Không phải PostgreSQL.

Ví dụ:

```text
┌──────────────────┐
│ API Container    │
│                  │
│ localhost ───────┼──→ API Container
└──────────────────┘
```

Trong khi PostgreSQL là container khác:

```text
API Container
     │
     │ postgres:5432
     ▼
PostgreSQL Container
```

Vì vậy API sử dụng:

```text
postgres
```

làm hostname.

---

# 7. Docker DNS

Các container nằm trong cùng Docker network có thể tìm nhau bằng service name.

CloudShop:

```text
api
postgres
redis
nginx
```

Docker cung cấp DNS nội bộ.

Ví dụ API gọi:

```text
postgres:5432
```

Docker DNS sẽ resolve:

```text
postgres
   ↓
Docker DNS
   ↓
PostgreSQL container IP
```

Tương tự:

```text
redis
 ↓
Docker DNS
 ↓
Redis Container
```

Vì vậy không nên hardcode container IP.

Container IP có thể thay đổi nhưng service name vẫn giữ nguyên.

---

# 8. `expose` vs `ports`

API sử dụng:

```yaml
expose:
  - "3000"
```

Trong khi Nginx sử dụng:

```yaml
ports:
  - "80:80"
```

Hai khái niệm này khác nhau.

## `expose`

```text
API :3000
```

được sử dụng cho giao tiếp nội bộ giữa các container.

Luồng:

```text
Nginx
 ↓
api:3000
```

API không cần được publish trực tiếp ra host.

---

## `ports`

```yaml
ports:
  - "80:80"
```

có cấu trúc:

```text
HOST_PORT : CONTAINER_PORT
```

CloudShop:

```text
Host :80
   ↓
Nginx Container :80
```

Do đó:

```text
Browser
   ↓
localhost:80
   ↓
Nginx
```

---

# 9. Tại sao chỉ Nginx publish port?

Ta muốn entry point của hệ thống là:

```text
Internet / Client
       ↓
     Nginx
       ↓
      API
```

Không phải:

```text
Client → PostgreSQL ❌
Client → Redis ❌
Client → API trực tiếp ❌
```

Do đó:

```text
Nginx
→ ports 80:80

API
→ internal :3000

PostgreSQL
→ internal :5432

Redis
→ internal :6379
```

Đây là bước đầu của tư duy giảm attack surface.

---

# 10. PostgreSQL Service

PostgreSQL sử dụng image:

```yaml
image: postgres:16-alpine
```

Database configuration:

```yaml
environment:
  POSTGRES_DB: cloudshop
  POSTGRES_USER: clouduser
  POSTGRES_PASSWORD: cloudpass
```

API sử dụng các thông tin tương ứng:

```text
DB_HOST     = postgres
DB_PORT     = 5432
DB_NAME     = cloudshop
DB_USER     = clouduser
DB_PASSWORD = cloudpass
```

Flow:

```text
CloudShop API
      │
      │ postgres:5432
      ▼
PostgreSQL
```

---

# 11. Docker Volume

PostgreSQL cần persistent storage.

CloudShop sử dụng:

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
```

Volume được khai báo:

```yaml
volumes:
  postgres-data:
```

Flow:

```text
PostgreSQL Container
        │
        │ /var/lib/postgresql/data
        ▼
    postgres-data
      Docker Volume
```

Nếu container bị xóa:

```text
PostgreSQL Container ❌
          │
          ▼
postgres-data vẫn tồn tại
```

Khi container mới mount lại volume:

```text
New PostgreSQL Container
          ↓
     postgres-data
          ↓
      dữ liệu cũ
```

---

# 12. Redis Service

Redis sử dụng:

```yaml
image: redis:7-alpine
```

Redis mặc định sử dụng:

```text
6379
```

API kết nối bằng:

```text
redis:6379
```

Flow:

```text
CloudShop API
      │
      │ redis:6379
      ▼
     Redis
```

Trong CloudShop local architecture, Redis đóng vai trò cache.

---

# 13. `depends_on`

API phụ thuộc vào:

```text
PostgreSQL
Redis
```

CloudShop sử dụng:

```yaml
depends_on:
  postgres:
    condition: service_healthy

  redis:
    condition: service_healthy
```

Tư duy:

```text
PostgreSQL ── healthy ──┐
                        │
Redis ─────── healthy ──┤
                        ▼
                   Start API
```

Nginx tiếp tục phụ thuộc API:

```text
PostgreSQL ──┐
             ├──→ API healthy
Redis ───────┘         │
                       ▼
                     Nginx
```

---

# 14. Health Check

PostgreSQL:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U clouduser -d cloudshop"]
```

Mục đích:

```text
PostgreSQL process
      ↓
pg_isready
      ↓
Database ready?
```

Redis:

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
```

Expected response:

```text
PONG
```

API:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
```

Flow:

```text
Docker
  ↓
GET /health
  ↓
API
  ↓
200?
```

---

# 15. Health Check khác `depends_on`

Đừng nhầm:

```text
healthcheck
```

và:

```text
depends_on
```

`healthcheck` trả lời:

```text
Service này healthy chưa?
```

`depends_on` trả lời:

```text
Service nào cần chờ service nào?
```

Kết hợp:

```text
PostgreSQL
    │
healthcheck
    │
    ▼
 healthy
    │
    │ depends_on
    ▼
   API
```

---

# 16. Nginx Reverse Proxy

Nginx là entry point của CloudShop local stack.

Flow:

```text
Client
  ↓
localhost:80
  ↓
Nginx
  ↓
api:3000
```

Nginx không cần biết container IP của API.

Nó có thể sử dụng:

```text
api:3000
```

nhờ Docker DNS.

---

# 17. Docker Network

CloudShop khai báo:

```yaml
networks:
  cloudshop-net:
    driver: bridge
```

Các service tham gia:

```yaml
networks:
  - cloudshop-net
```

Tư duy:

```text
                cloudshop-net

       ┌────────────┬────────────┐
       │            │            │
     nginx         api       postgres
                    │
                  redis
```

Network tạo một môi trường giao tiếp nội bộ cho CloudShop containers.

---

# 18. Khởi động CloudShop

Build và start:

```bash
docker compose up -d --build
```

Trong đó:

```text
up
= tạo/start services

-d
= chạy background

--build
= build lại image nếu cần
```

---

# 19. Kiểm tra trạng thái

```bash
docker compose ps
```

Kỳ vọng:

```text
cloudshop-postgres    healthy
cloudshop-redis       healthy
cloudshop-api         healthy
cloudshop-nginx       healthy
```

---

# 20. Kiểm tra Application

Health:

```bash
curl http://localhost/api/health
```

Readiness:

```bash
curl http://localhost/api/ready
```

Luồng request:

```text
curl
 ↓
localhost:80
 ↓
Nginx
 ↓
api:3000
 ↓
CloudShop API
```

---

# 21. Xem Logs

Toàn bộ stack:

```bash
docker compose logs
```

Theo dõi realtime:

```bash
docker compose logs -f
```

Một service:

```bash
docker compose logs api
```

Ví dụ khi API unhealthy:

```bash
docker compose logs api
```

là một trong những command đầu tiên cần kiểm tra.

---

# 22. Dừng Stack

```bash
docker compose down
```

Dừng và xóa container/network được Compose tạo.

Nếu dùng:

```bash
docker compose down -v
```

thì volume cũng bị xóa.

⚠️ Với PostgreSQL:

```text
docker compose down
        ↓
postgres-data còn

docker compose down -v
        ↓
postgres-data bị xóa
        ↓
database data bị xóa
```

---

# 23. Tư duy Debug Docker Compose

Khi CloudShop không chạy, kiểm tra theo dependency chain.

```text
PostgreSQL healthy?
        ↓
Redis healthy?
        ↓
API healthy?
        ↓
Nginx healthy?
        ↓
Request thành công?
```

Command đầu tiên:

```bash
docker compose ps
```

Nếu API lỗi:

```bash
docker compose logs api
```

Nếu database lỗi:

```bash
docker compose logs postgres
```

Nếu Redis lỗi:

```bash
docker compose logs redis
```

Nếu request qua gateway lỗi:

```bash
docker compose logs nginx
```

Không nên sửa tất cả service cùng lúc.

Hãy xác định service đầu tiên trong dependency chain bị lỗi.

---

# 🧠 Kiến thức cốt lõi cần note

```text
Docker Compose
= quản lý multi-container application

services
= các thành phần của application

Docker Network
= giao tiếp giữa containers

Docker DNS
= service name → container

Volume
= persistent data

ports
= Host → Container

expose
= container port dùng nội bộ

healthcheck
= kiểm tra trạng thái service

depends_on
= dependency/startup ordering
```

Điểm đặc biệt cần nhớ:

```text
localhost trong container
= chính container đó
```

Do đó:

```text
API → localhost:5432 ❌

API → postgres:5432 ✅
```

---

# 📌 CloudShop Local Flow

Flow cuối cùng cần nhớ:

```text
Client
  │
  │ localhost:80
  ▼
Nginx
  │
  │ api:3000
  ▼
CloudShop API
  │
  ├── postgres:5432
  │
  └── redis:6379
```

Tất cả service giao tiếp qua:

```text
cloudshop-net
```

PostgreSQL data được lưu tại:

```text
postgres-data
```