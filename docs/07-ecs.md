Phase — ECS Fargate Deployment
1. Mục tiêu

Deploy CloudShop API dưới dạng container lên AWS bằng:

Docker Image
    ↓
Amazon ECR
    ↓
ECS Cluster
    ↓
ECS Service
    ↓
ECS Fargate Tasks
    ↓
Application Load Balancer
    ↓
Internet

CloudShop hiện là backend stateless, không còn phụ thuộc RDS/Redis.

2. Các thành phần chính
ECS Cluster

Cluster là nơi logic để quản lý workload ECS.

Project:

cloudshop-cluster

Hiểu đơn giản:

ECS Cluster
    └── ECS Service
          ├── Task 1
          └── Task 2

Với Fargate, mình không cần tự quản lý EC2 server.

Task Definition

Task Definition giống như bản thiết kế container.

Nó định nghĩa:

Docker image
CPU
Memory
Container port
Environment variables
IAM role
Logging

Ví dụ CloudShop:

Container: cloudshop-api
Port:      3000
Image:     ECR/cloudshop-api
PORT:      3000
NODE_ENV:  production

Mỗi lần sửa Task Definition:

Revision 1
Revision 2
Revision 3
...

ECS không sửa revision cũ trực tiếp.

3. Task là gì?

Task = một instance đang chạy của Task Definition.

Ví dụ:

Task Definition
cloudshop-task:8

        ↓

Task A
Node.js API

Task B
Node.js API

Nếu Desired Count:

2

thì ECS cố duy trì:

2 Running Tasks

Nếu một task chết:

2 Tasks
   ↓
Task 1 ❌
Task 2 ✅
   ↓
ECS Service phát hiện
   ↓
Start Task 3
   ↓
Task 2 ✅
Task 3 ✅

Đây là self-healing của ECS Service.

4. ECS Service

Service có nhiệm vụ đảm bảo luôn có đủ số lượng Task theo mong muốn.

Ví dụ:

Desired Count = 2

ECS phải cố giữ:

Running Count = 2

Luồng:

ECS Service
     │
     ├── Task 1
     └── Task 2

Service cũng tích hợp với:

ALB
Auto Scaling
Deployment
Health Check
5. ECS Fargate

CloudShop sử dụng Fargate.

Khác với ECS EC2:

ECS EC2

User
 ↓
Quản EC2
 ↓
Docker
 ↓
Container

Fargate:

User
 ↓
Task Definition
 ↓
AWS quản lý server bên dưới
 ↓
Container

Mình chỉ quan tâm:

CPU
Memory
Networking
Container

Không cần:

SSH EC2
patch OS
upgrade server
manage worker node
6. Networking của ECS

ECS Task chạy trong:

Private Subnet A
Private Subnet B

Không expose trực tiếp ra Internet.

Kiến trúc:

                    Internet
                        │
                        ▼
                       ALB
                  Public Subnets
                        │
                        ▼
                ECS Security Group
                   /          \
                  ▼            ▼
             ECS Task 1    ECS Task 2
             Private A     Private B

User không gọi:

Internet → ECS Task

mà gọi:

Internet
   ↓
ALB
   ↓
ECS
7. Application Load Balancer

ALB nhận request từ Internet và phân phối đến các ECS Task.

Ví dụ:

Request 1 ──→ Task 1
Request 2 ──→ Task 2
Request 3 ──→ Task 1
Request 4 ──→ Task 2

ALB sử dụng Target Group.

ALB
 ↓
Target Group
 ├── Task 1 :3000
 └── Task 2 :3000

Trong project em đã thấy:

2 Healthy
0 Unhealthy

nghĩa là cả 2 Task đều pass health check.

8. Health Check

ALB định kỳ gọi health endpoint:

GET /health

Backend trả:

{
  "status": "healthy"
}

Nếu:

HTTP 200

→ Target:

Healthy ✅

Nếu app chết hoặc không trả được:

Unhealthy ❌

ALB sẽ không gửi traffic đến Task đó.

9. Luồng deploy ECS

CI/CD hiện tại có thể hiểu:

Developer
    ↓
git push
    ↓
GitHub Actions
    ↓
Build Docker Image
    ↓
Push Image → ECR
    ↓
ECS Deployment
    ↓
Start new Tasks
    ↓
ALB Health Check
    ↓
Healthy
    ↓
Stop old Tasks

Đây là rolling deployment cơ bản.

Phase — ECS Auto Scaling
10. Mục tiêu

Không muốn cố định:

2 Tasks mãi mãi

Vì traffic thay đổi.

Thay vào đó:

Traffic thấp
→ ít Task

Traffic cao
→ tăng Task

CloudShop cấu hình kiểu:

Minimum capacity: 2
Maximum capacity: 4

Target metric:
CPU Utilization ≈ 60%
11. Target Tracking Scaling

CloudShop sử dụng tư duy:

ECSServiceAverageCPUUtilization

Target:

60%

AWS cố giữ CPU trung bình quanh mức đó.

Ví dụ:

Task 1 CPU = 70%
Task 2 CPU = 80%

Average = 75%

75% > 60%

→ Auto Scaling có thể scale out.

12. Scale Out

Ban đầu:

Task 1
Task 2

Running = 2

k6 tạo traffic:

k6
 ↓
ALB
 ↓
ECS

CPU tăng:

CPU Average
20%
 ↓
40%
 ↓
60%
 ↓
70%

Target bị vượt:

70% > 60%

Auto Scaling:

2 Tasks
   ↓
3 Tasks
   ↓
4 Tasks

Task mới được:

Create
 ↓
Start
 ↓
Register Target Group
 ↓
ALB Health Check
 ↓
Healthy

Sau đó ALB có thể phân phối:

Traffic
   ↓
ALB
 ├── Task 1
 ├── Task 2
 ├── Task 3
 └── Task 4
13. Kết quả test thực tế CloudShop

Em đã load test bằng k6.

CPU:

CPU Maximum ≈ 100%
CPU Average ≈ 70%

CPU Average vượt target khoảng:

60%

Kết quả:

2 ECS Tasks
    ↓
Auto Scaling
    ↓
4 ECS Tasks

Target Group:

4 Healthy
0 Unhealthy

=> Scale Out thành công.

14. Scale In

Sau khi:

Ctrl + C

dừng k6:

Traffic ↓
CPU ↓

Auto Scaling không kill task ngay lập tức.

Nó chờ metric ổn định/cooldown.

Sau đó:

4 Tasks
   ↓
3 Tasks
   ↓
2 Tasks

Không xuống dưới:

Minimum capacity = 2

Đây là Scale In.

15. Tại sao có Min và Max?
Minimum = 2

Đảm bảo luôn có ít nhất:

Task A
Task B

Nếu một task gặp lỗi vẫn còn task khác phục vụ.

Ngoài ra có thể đặt hai task ở hai AZ:

AZ-A → Task 1

AZ-B → Task 2

tăng availability.

Maximum = 4

Không cho ECS scale vô hạn.

Ví dụ nếu bị traffic lớn:

2
4
10
50
100 Tasks

→ chi phí tăng mạnh.

Max giúp kiểm soát:

Availability
     +
Cost
16. Tại sao dùng CPU Average chứ không CPU Maximum?

Ví dụ:

Task 1 = 100%
Task 2 = 10%

Maximum:

100%

nhưng Average:

55%

Nếu policy dựa vào:

ECSServiceAverageCPUUtilization

thì Auto Scaling nhìn:

55%

chứ không phải 100%.

Đây là lý do lúc test đầu tiên em thấy:

CPU Maximum ≈ 13%

nhưng hệ thống vẫn không scale.

Sau khi dùng /stress, CPU Average thực sự vượt target → scale thành công.

17. Tại sao dùng k6?

API /products ban đầu rất nhẹ:

GET /products
 ↓
return JSON

nên dù gửi nhiều request:

CPU vẫn thấp

Mình tạo endpoint test CPU để chứng minh Auto Scaling.

k6:

Virtual Users
     ↓
ALB
     ↓
ECS
     ↓
CPU tăng

Nhờ đó kiểm chứng được:

Auto Scaling Policy
ALB
ECS
Target Group
Health Check

đều hoạt động cùng nhau.

18. Toàn bộ flow cần nhớ

Đây là phần quan trọng nhất.

                k6
                 │
                 ▼
             Internet
                 │
                 ▼
                ALB
                 │
                 ▼
           Target Group
            /       \
           ▼         ▼
       ECS Task   ECS Task
          │          │
          └────┬─────┘
               │
        CPU Utilization
               │
               ▼
        CloudWatch Metric
               │
               ▼
      ECS Service Auto Scaling
               │
       CPU > Target 60%
               │
               ▼
            Scale Out
               │
               ▼
          2 → 3 → 4 Tasks

Dừng load:

CPU ↓
 ↓
Auto Scaling
 ↓
Scale In
 ↓
4 → 3 → 2
19. Kiến thức cốt lõi cần thuộc

Em nên nhớ 7 khái niệm này:

ECS Cluster
    ↓
nơi quản lý workload

Task Definition
    ↓
blueprint của container

Task
    ↓
container workload đang chạy

Service
    ↓
duy trì số lượng Task

Fargate
    ↓
AWS quản lý server

ALB + Target Group
    ↓
phân phối traffic + health check

Auto Scaling
    ↓
tăng/giảm số lượng Task theo metric

Và mối quan hệ:

ECS Cluster
   └── Service
        ├── Task
        ├── Task
        └── Task

ALB
 ↓
Target Group
 ↓
Tasks

CloudWatch CPU
 ↓
Auto Scaling
 ↓
Service Desired Count