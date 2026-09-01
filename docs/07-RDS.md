Phase 7 — Amazon RDS PostgreSQL
1. Mục tiêu

Chuyển database từ PostgreSQL chạy trong container sang Amazon RDS PostgreSQL.

Trước:

ECS/API
  ↓
PostgreSQL container

Sau:

Internet
   ↓
ALB
   ↓
ECS Fargate
   ↓
TCP 5432 + SSL
   ↓
Amazon RDS PostgreSQL

Ý chính:

ECS chạy application, RDS lưu dữ liệu lâu dài.

2. Vì sao không để PostgreSQL trong ECS?

ECS Task có thể bị:

restart
scale in
deploy revision mới
replace

Nếu database nằm trong task:

Task chết
   ↓
Database chết
   ↓
Có nguy cơ mất dữ liệu

RDS là dịch vụ database managed, dữ liệu không phụ thuộc vòng đời ECS Task.

Nhớ:

ECS = stateless compute
RDS = stateful database
3. DB Subnet Group

Ta tạo:

cloudshop-db-subnet-group

gồm:

Private subnet A
10.0.11.0/24
ap-southeast-1a

Private subnet B
10.0.12.0/24
ap-southeast-1b

DB Subnet Group không phải subnet mới.

Nó chỉ nói với RDS:

RDS được phép nằm trong
        ↓
Private subnet A
Private subnet B
4. RDS Security Group

RDS sử dụng:

cloudshop-rds-sg

Inbound:

PostgreSQL
TCP
5432
Source = ECS Security Group

Kiến trúc:

ECS Task
ECS-SG
   │
   │ 5432
   ▼
RDS-SG
   │
   ▼
PostgreSQL

Không dùng:

0.0.0.0/0 → 5432 ❌
Vì sao dùng SG → SG?

IP của ECS Task có thể đổi.

Task cũ → 10.0.11.20
Task mới → 10.0.12.9

Nhưng Security Group vẫn giữ nguyên.

Vì vậy:

ECS-SG → RDS-SG

tốt hơn whitelist IP.

5. RDS của CloudShop

Cấu hình hiện tại:

DB identifier: cloudshop-db

Engine:
PostgreSQL 16.11

Instance:
db.t4g.micro

Database:
cloudshop

Master user:
postgres

Port:
5432

Storage:
20 GiB

Multi-AZ:
No

Encryption:
Enabled

Public access:
No

Điểm cần nhớ nhất:

Public access = No

RDS không cần mở ra Internet.

6. ECS kết nối RDS bằng gì?

Application Node.js dùng package:

const { Pool } = require("pg");

và:

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});

ECS Task Definition chứa:

DB_HOST=<RDS endpoint>
DB_PORT=5432
DB_NAME=cloudshop
DB_USER=postgres
DB_PASSWORD=<password>
DB_SSL=true
7. Local và AWS khác nhau thế nào?

Code không cần đổi theo môi trường.

Local:

DB_HOST=postgres
DB_SSL=false

AWS:

DB_HOST=<RDS endpoint>
DB_SSL=true

Ứng dụng đọc:

process.env.DB_HOST

nên cùng một Docker image có thể chạy ở nhiều môi trường.

Đây là tư duy quan trọng:

Code giống nhau
      +
Configuration khác nhau
8. RDS Endpoint là gì?

RDS cấp cho ta hostname kiểu:

cloudshop-db.xxxxx.ap-southeast-1.rds.amazonaws.com

ECS dùng nó làm:

DB_HOST

Không dùng:

http://... ❌

Vì PostgreSQL không phải HTTP.

Đúng:

host = RDS endpoint
port = 5432
9. SSL

Lúc đầu ta gặp:

no pg_hba.conf entry ...
no encryption

Ý nghĩa:

ECS → RDS ✅

nhưng

Connection không mã hóa ❌

Ta sửa:

DB_SSL=true

và Node.js dùng SSL.

Luồng thành:

ECS
 ↓
TLS encrypted connection
 ↓
RDS PostgreSQL
10. /health và /db-health

/health:

GET /health

chỉ kiểm tra:

Node.js API còn chạy không?

Response:

{
  "status": "healthy"
}

Dùng cho:

ALB Health Check

/db-health:

GET /db-health

thực hiện:

SELECT NOW();

Nó kiểm tra thật:

ECS
 ↓
RDS
 ↓
SQL query
 ↓
result

Kết quả thực tế của CloudShop:

{
  "status": "healthy",
  "database": "connected",
  "time": "..."
}

Đây là bằng chứng:

ALB → ECS → RDS ✅
11. Ba lỗi quan trọng đã gặp
Lỗi	Nguyên nhân	Bài học
ssm:GetParameters AccessDenied	Đặt DB_HOST nhầm vào Secrets	Environment variable khác Secret
no encryption	ECS kết nối PostgreSQL không SSL	RDS cần SSL
password authentication failed	Dùng cloudadmin nhưng master user thật là postgres	Kiểm tra credential thật của RDS

Cách đọc lỗi rất hay:

Timeout
→ thường nghĩ Network / Security Group

No encryption
→ Network đã thông, lỗi SSL

Password authentication failed
→ Network + SSL đã thông, lỗi credential

SELECT thành công
→ ECS ↔ RDS hoàn chỉnh
12. Luồng đầy đủ cần thuộc
User
 ↓
ALB
 ↓
ECS Fargate
 ↓
DB_HOST = RDS Endpoint
 ↓
ECS Security Group
 ↓
TCP 5432
 ↓
RDS Security Group
 ↓
SSL
 ↓
PostgreSQL
 ↓
SELECT NOW()
 ↓
Response
13. 6 kiến thức cốt lõi cần nhớ
1. RDS = managed relational database

2. RDS nên nằm private network

3. DB Subnet Group
   = nhóm subnet RDS được phép sử dụng

4. ECS SG → RDS SG :5432
   = kiểm soát quyền truy cập database

5. Application dùng RDS Endpoint
   không dùng IP cố định

6. ECS = stateless
   RDS = stateful
14. Câu trả lời phỏng vấn ngắn

Nếu interviewer hỏi:

“Em triển khai database trong CloudShop như thế nào?”

Em có thể trả lời:

Em sử dụng Amazon RDS PostgreSQL đặt trong private subnets. ECS Fargate kết nối tới RDS qua port 5432 bằng Security Group referencing, chỉ ECS Security Group được phép truy cập RDS Security Group. Database không public ra Internet. Application lấy RDS endpoint và credentials qua environment configuration và kết nối PostgreSQL bằng SSL. Em cũng tạo /db-health để thực hiện SELECT NOW() nhằm kiểm tra kết nối ECS tới RDS thực tế.

Chỉ cần nắm chắc phần trên là em đã hiểu bản chất Phase 7, không cần học thuộc từng bước bấm AWS Console.