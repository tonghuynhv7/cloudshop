# Phase 6 — AWS Networking

## 🎯 Mục tiêu

Mục tiêu của phase này là thiết kế network foundation cho CloudShop trước khi triển khai ECS, RDS và Redis.

Kiến trúc mạng cần đảm bảo:

- High Availability trên 2 Availability Zones.
- Public entry point chỉ qua Application Load Balancer.
- ECS workloads chạy trong private subnets.
- Database và Redis không public.
- Private workloads vẫn có outbound connectivity.
- Traffic giữa các tầng được kiểm soát bằng Security Groups.

---

# 1. Network Architecture

CloudShop sử dụng một VPC riêng:

```text
VPC
10.0.0.0/16
```

VPC được chia trên 2 Availability Zones:

```text
                         VPC 10.0.0.0/16
                               │
                  ┌────────────┴────────────┐
                  │                         │
                 AZ-A                      AZ-B
                  │                         │
          Public Subnet A           Public Subnet B
           10.0.1.0/24               10.0.2.0/24
                  │                         │
               NAT-A                     NAT-B
                  │                         │
          Private Subnet A          Private Subnet B
           10.0.11.0/24              10.0.12.0/24
                  │                         │
               ECS-A                      ECS-B
```

---

# 2. Tại sao dùng VPC?

VPC là network boundary riêng cho CloudShop trên AWS.

```text
AWS Account
   │
   └── cloudshop-vpc
```

Các resource như:

```text
ALB
ECS
RDS
Redis
```

sẽ được triển khai bên trong VPC này.

VPC giúp kiểm soát:

```text
IP Address Space
Subnets
Routing
Internet Connectivity
Security
```

---

# 3. CIDR Design

CloudShop dùng:

```text
10.0.0.0/16
```

Sau đó chia thành các subnet nhỏ hơn:

```text
10.0.1.0/24   → Public A
10.0.2.0/24   → Public B

10.0.11.0/24  → Private A
10.0.12.0/24  → Private B
```

Tư duy:

```text
10.0.0.0/16
    ↓
chia nhỏ
    ↓
nhiều /24 subnet
```

Thiết kế này giúp dễ quản lý và còn không gian cho mở rộng sau này.

---

# 4. Availability Zones

CloudShop sử dụng 2 AZ:

```text
ap-southeast-1a
ap-southeast-1b
```

Mục tiêu:

```text
AZ-A lỗi
   ↓
AZ-B vẫn còn workload
```

Multi-AZ giúp giảm phụ thuộc vào một fault domain duy nhất.

---

# 5. Public Subnets

CloudShop có:

```text
cloudshop-public-a
10.0.1.0/24

cloudshop-public-b
10.0.2.0/24
```

Public subnets dùng cho resource cần public routing như:

```text
Application Load Balancer
NAT Gateway
```

Điểm quan trọng:

> Subnet không trở thành public chỉ vì tên của nó là "public".

Subnet được xem là public khi route table của nó có route phù hợp tới Internet Gateway.

Ví dụ:

```text
0.0.0.0/0 → Internet Gateway
```

---

# 6. Private Subnets

CloudShop có:

```text
cloudshop-private-a
10.0.11.0/24

cloudshop-private-b
10.0.12.0/24
```

Private subnets dùng cho:

```text
ECS Tasks
RDS
ElastiCache Redis
```

Private workloads không nhận direct inbound traffic từ Internet.

Application flow:

```text
Internet
   ↓
ALB
   ↓
ECS
```

Không phải:

```text
Internet
   ↓
ECS trực tiếp
```

---

# 7. Internet Gateway

CloudShop sử dụng:

```text
cloudshop-igw
```

Internet Gateway được attach vào:

```text
cloudshop-vpc
```

Tư duy:

```text
VPC
 ↓
Internet Gateway
 ↓
Internet
```

Internet Gateway chỉ tạo khả năng kết nối ở mức VPC.

Subnet vẫn cần route table phù hợp để sử dụng IGW.

---

# 8. Public Route Table

CloudShop sử dụng:

```text
cloudshop-public-rt
```

Routes:

```text
10.0.0.0/16 → local
0.0.0.0/0   → cloudshop-igw
```

Associated subnets:

```text
cloudshop-public-a
cloudshop-public-b
```

Flow:

```text
Public Subnet
     ↓
Public Route Table
     ↓
Internet Gateway
     ↓
Internet
```

Hai public subnet có thể dùng chung một route table vì routing requirement của chúng giống nhau.

---

# 9. Route Table `local`

AWS tự tạo route:

```text
10.0.0.0/16 → local
```

Route này cho phép traffic giữa các subnet trong cùng VPC.

Ví dụ:

```text
ECS
 ↓
RDS
```

nếu cả hai nằm trong:

```text
10.0.0.0/16
```

thì routing nội bộ sử dụng route `local`.

---

# 10. NAT Gateway

CloudShop sử dụng 2 NAT Gateway:

```text
cloudshop-nat-a
cloudshop-nat-b
```

Mapping:

```text
AZ-A
Public-A
   ↓
NAT-A

AZ-B
Public-B
   ↓
NAT-B
```

NAT Gateway cho phép private workloads khởi tạo outbound connections mà không biến chúng thành public resources.

---

# 11. Tại sao NAT Gateway nằm trong Public Subnet?

NAT Gateway cần đi ra Internet qua Internet Gateway.

Flow:

```text
Private ECS
    ↓
NAT Gateway
    ↓
Public Subnet
    ↓
Internet Gateway
    ↓
Internet
```

Do đó public NAT Gateway phải nằm trong public subnet.

---

# 12. Elastic IP và NAT Gateway

Public NAT Gateway sử dụng Elastic IP.

Conceptually:

```text
Private ECS IP
10.0.11.x
    ↓
NAT
    ↓
Elastic Public IP
    ↓
Internet
```

Internet destination không nhìn thấy private IP `10.x.x.x` của ECS.

---

# 13. Private Route Table A

CloudShop sử dụng:

```text
cloudshop-private-rt-a
```

Routes:

```text
10.0.0.0/16 → local
0.0.0.0/0   → cloudshop-nat-a
```

Association:

```text
cloudshop-private-a
```

Flow:

```text
Private-A
    ↓
Private-RT-A
    ↓
NAT-A
    ↓
IGW
```

---

# 14. Private Route Table B

CloudShop sử dụng:

```text
cloudshop-private-rt-b
```

Routes:

```text
10.0.0.0/16 → local
0.0.0.0/0   → cloudshop-nat-b
```

Association:

```text
cloudshop-private-b
```

Flow:

```text
Private-B
    ↓
Private-RT-B
    ↓
NAT-B
    ↓
IGW
```

---

# 15. Tại sao dùng 2 NAT Gateway?

CloudShop dùng:

```text
AZ-A → NAT-A
AZ-B → NAT-B
```

thay vì:

```text
AZ-A ─┐
      ├→ NAT-A
AZ-B ─┘
```

Mục tiêu là Multi-AZ independence.

Nếu AZ-A gặp sự cố:

```text
AZ-A ❌
NAT-A ❌
```

workload trong AZ-B vẫn có:

```text
Private-B
    ↓
NAT-B
    ↓
Internet
```

Đổi lại:

```text
2 NAT Gateway
= chi phí cao hơn 1 NAT Gateway
```

Đây là trade-off giữa:

```text
Availability
vs
Cost
```

---

# 16. Inbound vs Outbound Traffic

Hai flow này phải phân biệt rõ.

## Inbound

User truy cập application:

```text
User
 ↓
Internet
 ↓
IGW
 ↓
ALB
 ↓
ECS
```

NAT Gateway KHÔNG nằm trong inbound path.

Sai:

```text
User
 ↓
NAT
 ↓
ALB
```

## Outbound

Private ECS cần đi ra ngoài:

```text
ECS
 ↓
Private Route Table
 ↓
NAT Gateway
 ↓
Public Route Table / IGW
 ↓
Internet
```

---

# 17. Public vs Private Subnet

Điểm khác biệt chính nằm ở routing.

## Public

```text
0.0.0.0/0
   ↓
IGW
```

## Private

```text
0.0.0.0/0
   ↓
NAT
```

Private subnet vẫn có thể outbound Internet.

Nó chỉ không có direct route tới IGW cho workload private.

---

# 18. Route Table vs Security Group

Đây là hai khái niệm khác nhau.

## Route Table

Trả lời:

```text
Traffic phải đi đâu?
```

Ví dụ:

```text
0.0.0.0/0 → NAT-A
```

## Security Group

Trả lời:

```text
Traffic có được phép hay không?
```

Ví dụ:

```text
ALB-SG → ECS-SG :3000
```

Connectivity cần:

```text
Correct Routing
      +
Allowed Security Rules
      ↓
Connection Works
```

---

# 19. Security Group Architecture

CloudShop sử dụng 4 Security Groups:

```text
cloudshop-alb-sg
cloudshop-ecs-sg
cloudshop-rds-sg
cloudshop-redis-sg
```

Trust flow:

```text
Internet
   │
   │ 80 / 443
   ▼
ALB-SG
   │
   │ 3000
   ▼
ECS-SG
   │
   ├── 5432 → RDS-SG
   │
   └── 6379 → Redis-SG
```

---

# 20. ALB Security Group

```text
cloudshop-alb-sg
```

Inbound:

```text
HTTP 80
Source: 0.0.0.0/0
```

Later:

```text
HTTPS 443
Source: 0.0.0.0/0
```

Tư duy:

```text
Internet
   ↓
ALB
```

ALB là application public entry point.

---

# 21. ECS Security Group

```text
cloudshop-ecs-sg
```

Inbound:

```text
TCP 3000
Source:
cloudshop-alb-sg
```

Không dùng:

```text
0.0.0.0/0 → 3000
```

vì ECS không cần nhận direct Internet traffic.

Correct flow:

```text
Internet
 ↓
ALB-SG
 ↓
ECS-SG :3000
```

---

# 22. Tại sao dùng SG làm Source?

Không nên phụ thuộc vào IP cụ thể của ALB.

Thay vào đó:

```text
Source:
cloudshop-alb-sg
```

có nghĩa:

> Traffic từ resource được associate với ALB security group được phép tới ECS port 3000.

Đây là service-to-service security relationship.

---

# 23. RDS Security Group

```text
cloudshop-rds-sg
```

Inbound:

```text
PostgreSQL
TCP 5432

Source:
cloudshop-ecs-sg
```

Flow:

```text
ECS
 ↓
5432
 ↓
RDS
```

Không mở:

```text
0.0.0.0/0 → 5432
```

---

# 24. Redis Security Group

```text
cloudshop-redis-sg
```

Inbound:

```text
TCP 6379

Source:
cloudshop-ecs-sg
```

Flow:

```text
ECS
 ↓
6379
 ↓
Redis
```

Redis không cần public Internet access.

---

# 25. Security Groups are Stateful

AWS Security Groups là stateful.

Nếu ECS khởi tạo connection đến RDS:

```text
ECS
 ↓
RDS :5432
```

return traffic của connection đó được state tracking xử lý.

Không cần tạo một inbound rule ngược chỉ để response quay lại cho established connection.

---

# 26. Full CloudShop Network Flow

## User Traffic

```text
User
 ↓
Internet
 ↓
IGW
 ↓
Public Subnets
 ↓
ALB
 ↓
ALB-SG
 ↓
ECS-SG
 ↓
Private ECS Tasks
```

## Database Traffic

```text
ECS-SG
 ↓
TCP 5432
 ↓
RDS-SG
```

## Redis Traffic

```text
ECS-SG
 ↓
TCP 6379
 ↓
Redis-SG
```

## ECS Outbound

AZ-A:

```text
ECS-A
 ↓
Private-RT-A
 ↓
NAT-A
 ↓
IGW
 ↓
Internet
```

AZ-B:

```text
ECS-B
 ↓
Private-RT-B
 ↓
NAT-B
 ↓
IGW
 ↓
Internet
```

---

# 27. Final Network Architecture

```text
                              INTERNET
                                  │
                                  ▼
                                 IGW
                                  │
                  ┌───────────────┴───────────────┐
                  │                               │
                 AZ-A                            AZ-B
                  │                               │
          Public Subnet A                 Public Subnet B
           10.0.1.0/24                     10.0.2.0/24
                  │                               │
               NAT-A                           NAT-B
                  │                               │
                  │            ALB                │
                  │          ALB-SG               │
                  │             │                 │
                  │          TCP 3000             │
                  ▼             ▼                 ▼
          Private Subnet A                Private Subnet B
          10.0.11.0/24                    10.0.12.0/24
                  │                               │
               ECS-A                           ECS-B
                  └──────────── ECS-SG ──────────┘
                                  │
                           ┌──────┴──────┐
                           │             │
                       TCP 5432       TCP 6379
                           │             │
                           ▼             ▼
                        RDS-SG        Redis-SG
                           │             │
                           ▼             ▼
                     PostgreSQL        Redis
```

---

# 28. AWS Resources Created

## VPC

```text
cloudshop-vpc
10.0.0.0/16
```

## Subnets

```text
cloudshop-public-a
10.0.1.0/24

cloudshop-public-b
10.0.2.0/24

cloudshop-private-a
10.0.11.0/24

cloudshop-private-b
10.0.12.0/24
```

## Internet Gateway

```text
cloudshop-igw
```

## NAT Gateways

```text
cloudshop-nat-a
cloudshop-nat-b
```

## Route Tables

```text
cloudshop-public-rt

cloudshop-private-rt-a

cloudshop-private-rt-b
```

## Security Groups

```text
cloudshop-alb-sg
cloudshop-ecs-sg
cloudshop-rds-sg
cloudshop-redis-sg
```

---

# 29. Tư duy Debug Networking

Khi connection fail, kiểm tra theo từng layer:

```text
Source
 ↓
Correct IP / DNS?
 ↓
Correct Subnet?
 ↓
Route Table?
 ↓
IGW / NAT?
 ↓
Security Group?
 ↓
Application Port?
 ↓
Application healthy?
```

Ví dụ ECS không ra Internet:

```text
Private subnet association đúng?
        ↓
Private RT có 0.0.0.0/0?
        ↓
Target đúng NAT?
        ↓
NAT Available?
        ↓
NAT nằm public subnet?
        ↓
Public RT có route IGW?
        ↓
IGW attached?
```

---

# 🧠 Kiến thức cốt lõi cần note

```text
VPC
= network boundary

CIDR
= address space

Availability Zone
= fault-isolation location

Subnet
= chia network theo AZ

Public Subnet
= route trực tiếp tới IGW

Private Subnet
= không direct route tới IGW

Internet Gateway
= VPC ↔ Internet

NAT Gateway
= private workload outbound

Route Table
= traffic đi đâu?

Security Group
= traffic nào được phép?
```

Quan trọng:

```text
Routing
+
Security
=
Connectivity
```

---

# 📌 CloudShop Network Design Summary

```text
Internet
 ↓
ALB
 ↓
ECS
 ├── RDS
 └── Redis
```

Public layer:

```text
ALB
NAT Gateway
```

Private layer:

```text
ECS
RDS
Redis
```

High Availability:

```text
AZ-A
+
AZ-B
```

Outbound:

```text
Private-A → NAT-A

Private-B → NAT-B
```

Security:

```text
Internet → ALB-SG :80/443

ALB-SG → ECS-SG :3000

ECS-SG → RDS-SG :5432

ECS-SG → Redis-SG :6379
```