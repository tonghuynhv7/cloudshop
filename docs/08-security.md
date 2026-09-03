PHASE 8 — SECURITY HARDENING
1. Mục tiêu Phase 8

Sau khi CloudShop đã chạy ổn trên:

GitHub Actions
      ↓
Amazon ECR
      ↓
ECS Fargate
      ↓
Application Load Balancer
      ↓
Auto Scaling

Phase 8 tập trung vào việc biến hệ thống từ:

"Deploy được"

thành:

"Deploy được + có security controls"

Các lớp bảo mật chính:

Security
├── Network Security
├── IAM Security
├── CI/CD Security
├── ECR Security
├── Container Security
├── HTTPS/TLS
└── Final Security Review
8.1 — Security Group Hardening
Kiến trúc

CloudShop không cho Internet truy cập trực tiếp ECS Task.

Internet
   │
   │ 80 / 443
   ▼
Application Load Balancer
   │
   │ 3000
   ▼
ECS Fargate
ALB Security Group

Inbound:

HTTP
Port: 80
Source: 0.0.0.0/0

HTTPS
Port: 443
Source: 0.0.0.0/0

ALB là public entry point nên cho phép Internet truy cập.

ECS Security Group

Inbound:

Custom TCP
Port: 3000
Source: ALB Security Group

Không dùng:

3000 ← 0.0.0.0/0 ❌
22   ← 0.0.0.0/0 ❌

Tức là:

Internet ─X→ ECS

Internet
   ↓
ALB
   ↓
ECS ✅
Kiến thức cần nhớ

Security Group có thể dùng Security Group khác làm source, thay vì CIDR.

Đây là cách rất hay cho kiến trúc:

ALB SG
  ↓
ECS SG
8.2 — Private ECS Networking

ECS Task chạy trong:

Private Subnet A
Private Subnet B

và:

Public IP = OFF

Kiến trúc:

                  Internet
                     │
                     ▼
              Public ALB
             /          \
      Public A          Public B
          │                │
          ▼                ▼
       ECS Task          ECS Task
      Private A         Private B

ECS không expose ENI trực tiếp ra Internet.

Nếu ECS cần outbound Internet:

ECS Private Subnet
       ↓
NAT Gateway
       ↓
Internet Gateway
       ↓
Internet
8.3 — IAM Least Privilege
Vấn đề ban đầu

GitHub Actions Role từng dùng:

AmazonEC2ContainerRegistryPowerUser

Policy này rộng hơn nhu cầu CloudShop.

Mục tiêu:

Không cấp:
AdministratorAccess ❌
AmazonECS_FullAccess ❌
ECR PowerUser ❌

Chỉ cấp quyền workflow thật sự cần ✅
GitHub Actions IAM Role

Role:

CloudShopGitHubActionsRole

Cuối cùng tách quyền thành:

CloudShopGitHubActionsRole
├── CloudShopECRPushPolicy
└── CloudShopECSDeployPolicy
CloudShopECRPushPolicy

GitHub chỉ được push image vào:

cloudshop-api

Các quyền chính:

ecr:GetAuthorizationToken

ecr:BatchCheckLayerAvailability
ecr:InitiateLayerUpload
ecr:UploadLayerPart
ecr:CompleteLayerUpload
ecr:PutImage

Nếu CD kiểm tra image tồn tại:

ecr:DescribeImages

Quan trọng:

GetAuthorizationToken
Resource = *

nhưng các quyền push được giới hạn:

arn:aws:ecr:ap-southeast-1:<account>:repository/cloudshop-api
8.3.1 — GitHub OIDC

CloudShop không lưu AWS Access Key dài hạn trong GitHub.

Luồng:

GitHub Actions
      ↓
OIDC token
      ↓
AWS STS
      ↓
AssumeRoleWithWebIdentity
      ↓
Temporary credentials

GitHub nhận temporary:

AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN

Chúng có thời hạn và GitHub tự mask trong log.

Trust Policy

Trust relationship giới hạn:

Repository:
tonghuynhv7/cloudshop

Branch:
main

Audience:
sts.amazonaws.com

Tư duy:

GitHub repo bất kỳ
       ❌

tonghuynhv7/cloudshop
main
       ✅

Đây là một điểm security rất đáng nói trong phỏng vấn.

8.3.2 — ECS Roles

Phải phân biệt 3 loại role:

GitHub Actions Role
→ CI/CD dùng

ECS Task Execution Role
→ ECS control plane dùng

ECS Task Role
→ code bên trong container dùng
Task Execution Role

CloudShop hiện dùng:

esc-pull-ecr

Nó phục vụ các việc như:

ECS
 ↓
Pull image ECR
 ↓
Start container
 ↓
CloudWatch Logs nếu cấu hình

CD chỉ có quyền:

iam:PassRole

cho đúng:

esc-pull-ecr

Không:

iam:PassRole Resource:* ❌
Task Role

Backend CloudShop hiện không gọi AWS API.

Nó chỉ có:

/health
/ready
/products

nên:

Task Role = None

hoặc role không có quyền đặc biệt là phù hợp.

8.4 — Tách CI và CD

Ban đầu workflow có:

CI
+
AWS Auth
+
ECR Push

trong cùng một file.

Sau đó tách:

.github/workflows/
├── ci.yml
└── cd.yml
CI

CI chỉ làm:

Checkout
 ↓
Node setup
 ↓
npm ci
 ↓
Syntax check
 ↓
Docker Compose
 ↓
Readiness
 ↓
Health test
 ↓
Cleanup

CI không cần:

AWS credentials ❌
OIDC permission ❌
ECR push ❌
ECS deploy ❌
CD

CD chỉ chạy sau khi:

CloudShop CI = SUCCESS

Sử dụng:

workflow_run

Luồng:

Push main
   ↓
CI
   ↓
PASS
   ↓
CD

Nếu:

CI FAIL

thì:

NO DEPLOY ✅
8.4.1 — Image Tag bằng Git Commit SHA

Không dùng:

latest

Thay bằng:

github commit SHA

Ví dụ:

8ed57f9e6a5149a07a1a02dccf0633285932b7ee

thành:

cloudshop-api:8ed57f9e6a5149a07a1a02dccf0633285932b7ee

Nhờ vậy:

Git commit
     ↕
Docker image
     ↕
Task Definition
     ↕
ECS deployment

trace rất rõ.

8.4.2 — ECR Immutable Tags

ECR được bật:

Tag immutability = ON

Nghĩa là:

cloudshop-api:abc123

đã tồn tại thì không được push đè.

Lúc đầu pipeline gặp:

tag invalid:
image tag already exists
and cannot be overwritten
because tag is immutable

Đây không phải lỗi ECR.

Nó chứng minh immutable hoạt động đúng.

Pipeline được thiết kế lại:

Check image exists
      ↓
 ┌────┴─────┐
 │          │
YES         NO
 │          │
skip      build
build       ↓
push      push
 │          │
 └────┬─────┘
      ↓
Deploy ECS

Nhờ vậy rerun CD cùng commit cũng không phá immutable policy.

8.5 — ECS Automatic Deployment

CD hiện không chỉ push ECR nữa.

Full flow:

Git push main
      ↓
CI
      ↓
PASS
      ↓
GitHub OIDC
      ↓
Build image
      ↓
Push ECR :commit-sha
      ↓
Get current Task Definition
      ↓
Replace image URI
      ↓
Register new revision
      ↓
Update ECS Service
      ↓
Rolling deployment
      ↓
Wait services-stable
Task Definition Revision

Ví dụ:

cloudshop-task:10
        ↓
cloudshop-task:11

Revision mới chứa:

cloudshop-api:<new-commit-sha>

Không sửa revision cũ.

Rolling Deployment

ECS thực tế đã xuất hiện:

Task mới start
       ↓
Register target
       ↓
ALB health check
       ↓
Healthy
       ↓
Task cũ deregister
       ↓
Draining connections
       ↓
Stop task cũ

Log đã thấy:

has begun draining connections
deregistered targets
stopped running tasks

Đây là rolling deployment.

GitHub CD chờ:

aws ecs wait services-stable

đến khi ECS ổn định.

8.6 — ECR Security Hardening

ECR cuối Phase 8:

Private repository          ✅
Immutable tags              ✅
Commit SHA tags             ✅
Least privilege IAM         ✅
Scan on push                ✅
Lifecycle policy            ✅
Vulnerability Scanning

CloudShop dùng:

Basic scanning

và:

Scan on push

Flow:

CD
 ↓
Push Docker image
 ↓
ECR
 ↓
Vulnerability scan
 ↓
Critical
High
Medium
Low

Không dùng Enhanced scanning lúc này để tránh Inspector cost không cần thiết.

Lifecycle Policy

Rule:

Priority: 1

Image status:
Any

Match:
Image count

Keep:
10 images

Action:
Expire

Tức là:

10 image gần nhất → giữ

image cũ hơn → expire

Mục tiêu:

Không để ECR phình vô hạn
+
Vẫn giữ đủ image cũ để rollback
8.7 — Container Hardening

Dockerfile định hướng:

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
Alpine
node:20-alpine

giúp base image nhỏ hơn.

Production Dependencies Only
RUN npm ci --omit=dev

Không cài dev dependencies không cần thiết.

Kết quả:

ít package
↓
image nhỏ
↓
attack surface nhỏ hơn
Non-root Container

Quan trọng:

USER node

Container không chạy ứng dụng dưới root.

Test:

docker compose exec api whoami

Mong đợi:

node

Phần này nên verify lần cuối nếu em chưa chạy lệnh whoami.

.dockerignore

Nên có:

node_modules
npm-debug.log

.git
.github
.gitignore

.env
.env.*

README.md
terraform
*.md

Mục tiêu:

Không copy:
.git
.env
CI config
Terraform
file local

vào production image.

Đặc biệt:

.env

không được bake vào Docker image.

Express Fingerprinting

Response từng có:

X-Powered-By: Express

Có thể giảm fingerprinting bằng:

app.disable("x-powered-by");

Sau đó kiểm tra:

curl -I https://tonghuynh.me/health

Không còn:

X-Powered-By: Express

Đây là hardening nhỏ; nếu chưa làm thì có thể làm nốt trước khi chốt Phase 8 hoàn toàn.

8.8 — DNS + HTTPS

Domain:

tonghuynh.me

được mua ở:

Namecheap

nhưng DNS chuyển sang:

Amazon Route 53

Mô hình:

Namecheap
   │
   │ Registrar
   ▼
tonghuynh.me
   │
Nameservers
   ▼
Route 53

Namecheap giữ vai trò registrar.

Route 53 giữ vai trò authoritative DNS.

ACM Certificate

Request certificate:

tonghuynh.me
*.tonghuynh.me

DNS Validation qua Route 53.

Sau validation:

Certificate status:
Issued ✅

Wildcard cho phép sau này dùng:

api.tonghuynh.me
www.tonghuynh.me
cloudshop.tonghuynh.me
HTTPS Listener

ALB:

HTTPS
Port 443
Certificate: ACM
Forward → Target Group

Luồng:

User
 ↓
HTTPS
 ↓
ALB :443
 ↓
TLS termination
 ↓
HTTP :3000
 ↓
ECS

ECS không cần tự xử lý TLS.

Đây gọi là:

TLS termination at Application Load Balancer

HTTP → HTTPS Redirect

Listener port 80 không forward trực tiếp vào Target Group nữa.

Nó làm:

HTTP :80
   ↓
301 Redirect
   ↓
HTTPS :443

Test thực tế:

curl -v http://tonghuynh.me/health

đã trả:

HTTP/1.1 301 Moved Permanently
Location: https://tonghuynh.me:443/health

=> PASS ✅

HTTPS Test
curl https://tonghuynh.me/health

đã trả:

{"status":"healthy"}

Certificate test cũng xác nhận:

TLSv1.3
SSL certificate verify ok
CN=tonghuynh.me

=> HTTPS hoạt động đúng.

8.9 — ALB Multi-AZ Security / Reachability

Đây là một lỗi thực tế khá hay em đã debug được.

Domain resolve ra 2 ALB IP.

Test:

13.228.x.x
→ 200 OK ✅

18.136.x.x
→ timeout ❌

Điều này cho thấy một ALB node/AZ gặp vấn đề reachability.

Kiểm tra Network Mapping phát hiện:

subnet 10.0.11.0/24

Reachability may be impacted ⚠️

ALB đang gắn nhầm subnet.

Sau đó sửa thành đúng 2 public subnet:

ap-southeast-1a
10.0.1.0/24

ap-southeast-1b
10.0.2.0/24

Không còn:

Reachability may be impacted

Kiến trúc đúng:

                Internet
                   │
                   ▼
            Internet Gateway
             /            \
            /              \
 Public Subnet A       Public Subnet B
 10.0.1.0/24          10.0.2.0/24
       │                    │
    ALB Node             ALB Node
       ✅                    ✅

Đây là case rất tốt để nói trong phỏng vấn:

“I diagnosed an ALB Multi-AZ reachability issue by testing individual ALB IPs with curl --resolve and identified an incorrectly mapped subnet.”

8.10 — Final Architecture

Sau Security Hardening:

                         Internet
                            │
                            │ HTTP / HTTPS
                            ▼
                    ┌───────────────┐
                    │   Route 53    │
                    │ tonghuynh.me  │
                    └───────┬───────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │ ALB + ACM         │
                  │ Public / Multi-AZ │
                  └────────┬──────────┘
                           │
                           │ TCP 3000
                           │ ALB SG only
                  ┌────────┴────────┐
                  │                 │
                  ▼                 ▼
             ECS Task A        ECS Task B
             Private AZ-A      Private AZ-B
                  │                 │
                  └───────┬─────────┘
                          │
                    Auto Scaling
                     Min 2 / Max 4

CI/CD:

Developer
   │
   │ git push main
   ▼
GitHub
   │
   ▼
CloudShop CI
   │
   ├── npm ci
   ├── syntax check
   ├── Docker Compose
   ├── readiness
   └── health
   │
   ▼
CI PASS
   │
   ▼
CloudShop CD
   │
   │ OIDC
   ▼
AWS STS
   │
   ▼
Least Privilege IAM
   │
   ▼
ECR
   │
   ├── Private
   ├── SHA Tags
   ├── Immutable
   ├── Scan
   └── Lifecycle
   │
   ▼
Task Definition Revision
   │
   ▼
ECS Rolling Deployment
   │
   ▼
ALB Health Check
   │
   ▼
Production