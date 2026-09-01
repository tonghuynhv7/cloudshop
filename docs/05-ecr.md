# Phase 5 — Amazon ECR

## 🎯 Mục tiêu

Mục tiêu của phase này là tự động build CloudShop Docker image trên GitHub Actions và lưu image vào Amazon ECR.

Flow:

```text
Source Code
    ↓
GitHub Actions
    ↓
Docker Build
    ↓
Docker Image
    ↓
Image Tag
    ↓
Docker Push
    ↓
Amazon ECR
```

Sau phase này, CloudShop đã tạo được deployment artifact trên AWS.

Sau này:

```text
Amazon ECR
     ↓
ECS Fargate
```

ECS sẽ sử dụng image đã được lưu trong ECR.

---

# 1. Amazon ECR là gì?

ECR = Elastic Container Registry.

Amazon ECR là container registry của AWS.

Nhiệm vụ chính:

```text
Store
Manage
Version
Distribute

Docker / OCI Images
```

CloudShop sử dụng ECR để lưu API image.

```text
GitHub Actions
      ↓
Docker Image
      ↓
Amazon ECR
      ↓
cloudshop-api
```

---

# 2. Tại sao cần Container Registry?

Sau khi chạy:

```bash
docker build -t cloudshop-api:v1 .
```

image chỉ tồn tại trong Docker environment nơi nó được build.

Ví dụ:

```text
GitHub Runner
     │
     └── cloudshop-api:v1
```

Nhưng GitHub Runner chỉ là môi trường CI tạm thời.

Ta cần đưa image tới nơi lưu trữ trung tâm:

```text
GitHub Runner
     ↓
Amazon ECR
     ↓
Persistent Image Repository
```

Sau đó deployment platform có thể lấy image:

```text
Amazon ECR
     ↓
ECS
```

---

# 3. Registry vs Repository vs Image vs Tag

Đây là phần cần phân biệt rõ.

Một image reference có dạng:

```text
REGISTRY/REPOSITORY:TAG
```

Ví dụ:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/cloudshop-api:abc123
```

Tách ra:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com
                    │
                    ▼
                 Registry


cloudshop-api
     │
     ▼
 Repository


abc123
  │
  ▼
 Tag
```

---

# 4. Registry

Registry là nơi chứa các container repository.

Ví dụ:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com
```

Có thể hình dung:

```text
ECR Registry
│
├── cloudshop-api
├── payment-api
├── user-api
└── worker
```

CloudShop hiện sử dụng repository:

```text
cloudshop-api
```

---

# 5. Repository

Repository là nơi chứa các version của một container image/application.

Ví dụ:

```text
cloudshop-api
│
├── :abc123
├── :def456
├── :789xyz
└── :latest
```

Tất cả đều thuộc:

```text
cloudshop-api
```

nhưng có các tag khác nhau.

---

# 6. Image Tag

Tag dùng để đặt tên/đánh dấu một image version.

Ví dụ:

```text
cloudshop-api:v1
cloudshop-api:v2
cloudshop-api:latest
cloudshop-api:abc123
```

Tag không phải là một image registry riêng.

Có thể có nhiều tag tham chiếu tới cùng một image.

---

# 7. Full Image URI

ECR image URI có cấu trúc:

```text
<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPOSITORY>:<TAG>
```

CloudShop:

```text
<ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/cloudshop-api:<TAG>
```

Cần nhớ:

```text
Registry
    /
Repository
    :
Tag
```

---

# 8. Tại sao CloudShop dùng Git SHA?

GitHub Actions cung cấp:

```yaml
${{ github.sha }}
```

Đây là commit SHA liên quan tới workflow run.

Ví dụ:

```text
3fcc8f91db9998a50c39...
```

CloudShop dùng nó làm image tag:

```yaml
IMAGE_TAG: ${{ github.sha }}
```

Kết quả:

```text
cloudshop-api:3fcc8f91db9998a50c39...
```

---

# 9. Traceability

Đây là lý do quan trọng nhất để sử dụng Git SHA.

Giả sử production đang chạy:

```text
cloudshop-api:abc123
```

Ta có thể truy ngược:

```text
Production
    ↓
Docker Image
    ↓
Tag abc123
    ↓
Git Commit abc123
    ↓
Source Code
```

Nhờ đó có thể trả lời:

> Version code nào đang được deploy?

Không cần đoán.

---

# 10. Rollback

Giả sử:

```text
abc123
= version ổn định

def456
= version mới có lỗi
```

ECR có:

```text
cloudshop-api:abc123
cloudshop-api:def456
```

Nếu version mới lỗi:

```text
def456 ❌
   ↓
rollback
   ↓
abc123
```

Không nhất thiết phải rebuild source code cũ.

Ta có thể deploy lại artifact/version đã tồn tại nếu deployment design hỗ trợ điều đó.

---

# 11. `latest` là gì?

`latest` chỉ là một Docker tag.

Ví dụ:

```text
cloudshop-api:latest
```

Điểm quan trọng:

```text
latest
≠ Docker tự tìm image mới nhất
```

Nó chỉ là tên tag.

Nếu ta build:

```bash
docker build -t cloudshop-api:latest .
```

thì image được gắn tag `latest`.

---

# 12. Tại sao có thể dùng cả SHA và `latest`?

Một build có thể được gắn nhiều tag:

```bash
docker build \
  -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
  -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
  .
```

Ví dụ:

```text
Image ID: xyz
│
├── cloudshop-api:abc123
└── cloudshop-api:latest
```

Cả hai tag có thể trỏ tới cùng image.

---

# 13. SHA vs `latest`

## SHA

```text
cloudshop-api:abc123
```

Ưu điểm:

```text
Exact version
Traceable
Rollback friendly
Predictable
```

## latest

```text
cloudshop-api:latest
```

Thuận tiện cho một số workflow đơn giản, nhưng không thể hiện version cụ thể.

Ví dụ:

```text
latest
```

hôm nay có thể trỏ tới:

```text
abc123
```

sau lần push tiếp theo lại có thể trỏ tới:

```text
def456
```

Vì vậy production deployment nên ưu tiên version identifier rõ ràng như commit SHA thay vì chỉ dựa vào `latest`.

---

# 14. Build Once — Deploy Same Artifact

Một nguyên tắc quan trọng:

```text
Source Code
    ↓
BUILD ONCE
    ↓
Docker Image
    ↓
ECR
    ↓
Deploy
```

Không nên thiết kế kiểu:

```text
GitHub builds image
      ↓
Production rebuilds source again
```

Mục tiêu:

```text
Artifact đã test
      ↓
Artifact được lưu
      ↓
Deploy chính artifact đó
```

Sau này:

```text
Git Commit
    ↓
GitHub Actions
    ↓
Docker Image
    ↓
ECR
    ↓
ECS
```

---

# 15. GitHub Actions ECR Variables

CloudShop sử dụng:

```yaml
env:
  ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
  ECR_REPOSITORY: cloudshop-api
  IMAGE_TAG: ${{ github.sha }}
```

Ba biến này tạo thành:

```text
$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
```

Ví dụ:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/cloudshop-api:abc123
```

---

# 16. ECR Registry Login

Trước khi:

```bash
docker push
```

Docker client phải authenticate với ECR registry.

Flow:

```text
GitHub Runner
      ↓
Temporary AWS Credentials
      ↓
ECR Authentication
      ↓
Docker authenticated to ECR
      ↓
docker push
```

Trong GitHub Actions có thể sử dụng ECR login action.

Conceptually:

```text
AWS Identity
     ↓
ECR Auth
     ↓
Docker Registry Login
```

---

# 17. Authentication và Authorization

Đừng nhầm hai việc.

## Authentication với AWS

```text
GitHub
 ↓
OIDC
 ↓
STS
 ↓
IAM Role
```

Trả lời:

```text
Workflow đang sử dụng AWS identity nào?
```

## Authorization với ECR

```text
IAM Role
 ↓
Permission Policy
 ↓
ECR
```

Trả lời:

```text
Role có được phép thực hiện ECR action này không?
```

Sau đó Docker còn cần registry authentication để push image.

---

# 18. Build Docker Image

CloudShop build:

```bash
docker build \
  -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
  .
```

Flow:

```text
Source Code
    ↓
Dockerfile
    ↓
docker build
    ↓
Docker Image
    ↓
ECR-compatible image tag
```

Nếu dùng thêm `latest`:

```bash
docker build \
  -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
  -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
  .
```

thì cùng một build được gắn hai tag.

---

# 19. Push Docker Image

Sau khi build:

```bash
docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
```

Nếu sử dụng `latest`:

```bash
docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
```

Flow:

```text
GitHub Runner
      ↓
Local Docker Image
      ↓
docker push
      ↓
Amazon ECR
```

---

# 20. Docker Image Layers

Docker image gồm nhiều layer.

Conceptually:

```text
CloudShop Image
│
├── Base Image Layer
├── Dependency Layer
├── Application Layer
└── Metadata
```

Khi push, Docker/ECR không nhất thiết phải upload lại mọi layer nếu registry đã có layer tương ứng.

Flow:

```text
Docker
 ↓
Check Layer
 ↓
Exists?
 /   \
YES   NO
 │     │
skip  upload
```

Điều này liên quan trực tiếp đến các ECR permissions.

---

# 21. ECR Push Permissions

Các permission quan trọng gồm:

```text
ecr:GetAuthorizationToken

ecr:BatchCheckLayerAvailability

ecr:InitiateLayerUpload

ecr:UploadLayerPart

ecr:CompleteLayerUpload

ecr:PutImage
```

Có thể hiểu theo flow.

---

# 22. `ecr:GetAuthorizationToken`

Dùng trong quá trình authentication với ECR.

```text
AWS Credentials
      ↓
GetAuthorizationToken
      ↓
ECR authentication
```

---

# 23. `ecr:BatchCheckLayerAvailability`

Docker/ECR kiểm tra layer đã tồn tại chưa.

```text
Image Layer
    ↓
Check ECR
   /    \
Exists  Missing
  │       │
 skip    upload
```

---

# 24. `ecr:InitiateLayerUpload`

Nếu layer chưa tồn tại:

```text
Missing Layer
     ↓
InitiateLayerUpload
     ↓
Start Upload
```

---

# 25. `ecr:UploadLayerPart`

Một layer có thể được upload theo từng phần.

```text
Layer
├── Part
├── Part
└── Part
```

Permission:

```text
ecr:UploadLayerPart
```

cho phép upload các phần dữ liệu này.

---

# 26. `ecr:CompleteLayerUpload`

Sau khi các phần đã được upload:

```text
Parts uploaded
      ↓
CompleteLayerUpload
      ↓
Layer completed
```

---

# 27. `ecr:PutImage`

Sau khi các layer cần thiết đã tồn tại trong registry:

```text
Layers
   ↓
Image Manifest
   ↓
PutImage
   ↓
Image registered
```

`PutImage` là một permission quan trọng để hoàn tất việc đăng ký image trong repository.

---

# 28. Permission Flow

Có thể nhớ:

```text
GetAuthorizationToken
        ↓
Login
        ↓
BatchCheckLayerAvailability
        ↓
Missing layer?
        ↓
InitiateLayerUpload
        ↓
UploadLayerPart
        ↓
CompleteLayerUpload
        ↓
PutImage
        ↓
Image available in ECR
```

Không cần học thuộc ngay từng permission.

Quan trọng là hiểu:

> `docker push` nhìn như một command nhưng phía AWS cần nhiều API actions phía sau.

---

# 29. Least Privilege

Trong lúc học có thể tạm sử dụng policy rộng hơn để giảm độ phức tạp.

Nhưng mục tiêu cuối cùng nên là:

```text
GitHub Actions Role
        ↓
Only required ECR actions
        ↓
Only required repository
```

Thay vì:

```text
GitHub Actions Role
        ↓
All ECR
        ↓
All repositories
```

Nguyên tắc:

```text
Give only the permissions required
to perform the intended task.
```

---

# 30. Một điểm đặc biệt của `GetAuthorizationToken`

Khi viết custom ECR policy, cần chú ý `ecr:GetAuthorizationToken` không được scope theo một ECR repository ARN theo cách các repository-level push actions thường được scope.

Conceptually:

```text
GetAuthorizationToken
→ Resource: "*"
```

Trong khi các action push repository có thể được giới hạn vào repository CloudShop.

Ví dụ tư duy:

```text
GetAuthorizationToken
        ↓
Registry authentication

Push permissions
        ↓
cloudshop-api repository only
```

---

# 31. CI + ECR Flow

Sau khi kết hợp phase CI và ECR:

```text
Git Push
    ↓
GitHub Actions
    ↓
Test Job
    ↓
PASS
    ↓
Build & Push Job
    ↓
OIDC
    ↓
AWS STS
    ↓
IAM Role
    ↓
Temporary Credentials
    ↓
ECR Login
    ↓
Docker Build
    ↓
Tag with Git SHA
    ↓
Docker Push
    ↓
Amazon ECR
```

---

# 32. Pull Request vs Main

Pull Request:

```text
Feature
 ↓
PR
 ↓
CI Test
 ↓
PASS / FAIL
 ↓
STOP
```

Main:

```text
Main
 ↓
CI
 ↓
PASS
 ↓
AWS Authentication
 ↓
Build Image
 ↓
Push ECR
```

Điều này giúp tách:

```text
Validation
```

và:

```text
Artifact Delivery
```

---

# 33. Debug — Dockerfile Not Found

Ví dụ lỗi:

```text
failed to read dockerfile:
open Dockerfile: no such file or directory
```

Tư duy:

```text
docker build
    ↓
Build context ở đâu?
    ↓
Dockerfile nằm ở đâu?
```

Kiểm tra:

```bash
pwd
ls -la
find . -name "Dockerfile"
```

Nếu Dockerfile không nằm trong build context mặc định, cần chỉ đúng:

```bash
docker build -f path/to/Dockerfile .
```

Không nên debug IAM/ECR khi `docker build` còn chưa thành công.

---

# 34. Debug — ECR Login Failure

Nếu fail ở:

```text
Login ECR
```

kiểm tra theo flow:

```text
OIDC successful?
      ↓
Role assumed?
      ↓
GetAuthorizationToken allowed?
      ↓
Region correct?
      ↓
Registry correct?
```

Có thể kiểm tra identity:

```bash
aws sts get-caller-identity
```

---

# 35. Debug — Push AccessDenied

Nếu:

```text
AWS authentication ✅
ECR login          ✅
Docker build       ✅
Docker push        ❌
```

thì tập trung vào:

```text
ECR repository
IAM Permission Policy
ECR push actions
```

Ví dụ action bị denied:

```text
ecr:PutImage
```

→ kiểm tra permission policy.

Không cần sửa OIDC trust nếu:

```text
aws sts get-caller-identity
```

đã thành công.

---

# 36. Debug theo Layer

Khi pipeline lỗi:

```text
OIDC?
 ↓
STS?
 ↓
IAM Role?
 ↓
ECR Login?
 ↓
Docker Build?
 ↓
Docker Tag?
 ↓
Docker Push?
```

Tìm mắt xích đầu tiên bị lỗi.

Ví dụ:

```text
Docker Build ❌
```

thì ECR permission chưa phải vấn đề.

Ví dụ:

```text
Build ✅
Login ✅
Push ❌
```

thì tập trung ECR permissions/repository.

---

# 🧠 Kiến thức cốt lõi cần note

```text
ECR
= container registry của AWS

Registry
= nơi chứa repositories

Repository
= nơi chứa image versions

Image
= deployment artifact

Tag
= identifier/reference cho image

Git SHA
= version identifier có traceability

latest
= chỉ là một tag

ECR Login
= authenticate Docker client với registry

docker build
= source → image

docker push
= local image → ECR
```

Cấu trúc phải nhớ:

```text
REGISTRY/REPOSITORY:TAG
```

Ví dụ:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/cloudshop-api:abc123
```

---

# 📌 Artifact Traceability

Điểm quan trọng nhất của phase ECR:

```text
Git Commit
    │
    │ abc123
    ▼
GitHub Actions
    │
    ▼
Docker Build
    │
    ▼
cloudshop-api:abc123
    │
    ▼
Amazon ECR
```

Sau này:

```text
cloudshop-api:abc123
        ↓
ECS Task Definition
        ↓
ECS Task
```

Nhờ đó:

```text
Running Container
       ↓
Docker Image
       ↓
Image Tag
       ↓
Git Commit
       ↓
Source Code
```

---

# 📌 CloudShop Progress After ECR

Đến thời điểm này:

```text
Application
    ↓
Docker
    ↓
Docker Compose
    ↓
GitHub Actions CI
    ↓
GitHub OIDC
    ↓
AWS STS
    ↓
IAM Role
    ↓
Docker Build
    ↓
Amazon ECR
```

CloudShop đã có:

```text
Source Code
+
Automated Validation
+
Versioned Deployment Artifact
```

Nhưng chưa có AWS runtime environment.

Bước tiếp theo là thiết kế nơi artifact này sẽ chạy:

```text
Amazon ECR
     ↓
     ?
     ↓
CloudShop Runtime
```

Đó là lý do phase tiếp theo bắt đầu với AWS Networking trước khi triển khai ECS.