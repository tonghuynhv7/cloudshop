# Phase 4 — GitHub OIDC, AWS STS & IAM

## 🎯 Mục tiêu

Mục tiêu của phase này là cho phép GitHub Actions truy cập AWS mà không cần lưu long-lived AWS Access Key trong GitHub Secrets.

CloudShop sử dụng:

```text
GitHub Actions
      ↓
OIDC
      ↓
AWS STS
      ↓
IAM Role
      ↓
Temporary Credentials
      ↓
AWS
```

---

# 1. Vấn đề cần giải quyết

GitHub Actions cần thực hiện các thao tác AWS như:

```text
Push image → Amazon ECR
Deploy → Amazon ECS
```

Nhưng GitHub không mặc định có quyền truy cập AWS.

Ta cần giải quyết:

```text
GitHub
   ↓
"Làm sao AWS biết đây là workflow hợp lệ?"
   ↓
AWS
```

---

# 2. Cách truyền thống — Access Key

Một cách đơn giản là tạo IAM User và lưu:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

trong GitHub Secrets.

Flow:

```text
GitHub Actions
      ↓
AWS Access Key
      ↓
AWS
```

Vấn đề là credential có thể tồn tại lâu dài và phải được lưu trữ, bảo vệ và rotate.

CloudShop sử dụng OIDC thay cho cách này.

---

# 3. OIDC là gì?

OIDC = OpenID Connect.

Trong CloudShop, OIDC cho phép GitHub cung cấp một identity token để chứng minh thông tin về workflow đang chạy.

Flow:

```text
GitHub Actions
      ↓
Request OIDC Token
      ↓
GitHub OIDC Provider
      ↓
Signed Token
```

Token này sau đó được gửi đến AWS STS.

---

# 4. JWT là gì?

OIDC token thường được biểu diễn dưới dạng JWT.

JWT = JSON Web Token.

Có thể hình dung:

```text
JWT
├── Header
├── Payload
└── Signature
```

Payload chứa các claims mô tả identity/context của token.

Ví dụ về mặt khái niệm:

```json
{
  "iss": "https://token.actions.githubusercontent.com",
  "aud": "sts.amazonaws.com",
  "sub": "repo:OWNER/REPOSITORY:ref:refs/heads/main"
}
```

Các claim quan trọng:

```text
iss
= token được phát hành bởi ai?

aud
= token dành cho service nào?

sub
= token đại diện cho workflow/repository/context nào?
```

---

# 5. JWT Signature dùng để làm gì?

Nếu chỉ có JSON:

```json
{
  "sub": "repo:myrepo:main"
}
```

thì bất kỳ ai cũng có thể tự viết.

JWT có chữ ký để bên nhận có thể xác minh token được phát hành bởi issuer hợp lệ và không bị sửa đổi theo cách không hợp lệ.

Tư duy:

```text
Claims
   +
Cryptographic Signature
   ↓
Verifiable Token
```

AWS không đơn giản tin một đoạn JSON do client gửi lên.

---

# 6. AWS IAM OIDC Provider

AWS cần được cấu hình để nhận diện GitHub OIDC provider.

Conceptually:

```text
AWS IAM
   │
   └── OIDC Provider
           │
           └── token.actions.githubusercontent.com
```

Provider nói với AWS:

```text
GitHub OIDC là một identity provider
mà IAM có thể sử dụng trong federation.
```

Nhưng:

```text
Có OIDC Provider
≠
mọi GitHub repository đều được vào AWS
```

Repository/workflow nào được assume role còn phụ thuộc vào IAM Role Trust Policy.

---

# 7. IAM Role

CloudShop sử dụng role:

```text
CloudShopGitHubActionsRole
```

GitHub Actions không trở thành IAM User.

Thay vào đó:

```text
GitHub Actions
      ↓
Assume
      ↓
CloudShopGitHubActionsRole
```

Có thể hiểu:

```text
IAM User
= identity tương đối lâu dài

IAM Role
= identity có thể được assume để nhận quyền tạm thời
```

---

# 8. Trust Policy

Trust Policy trả lời:

> WHO được phép assume IAM Role?

Ví dụ logic:

```text
GitHub OIDC Provider
        ↓
Repository đúng?
        ↓
Branch đúng?
        ↓
Audience đúng?
        ↓
Cho phép AssumeRoleWithWebIdentity
```

Ví dụ cấu trúc:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:OWNER/cloudshop:ref:refs/heads/main"
    }
  }
}
```

---

# 9. Hiểu `Principal`

```json
"Principal": {
  "Federated": "..."
}
```

Nó xác định federated identity provider được trust trong statement này.

CloudShop sử dụng GitHub OIDC provider.

Tư duy:

```text
GitHub OIDC Provider
        ↓
IAM Trust Relationship
        ↓
CloudShopGitHubActionsRole
```

---

# 10. `AssumeRoleWithWebIdentity`

Action:

```text
sts:AssumeRoleWithWebIdentity
```

là cơ chế STS dùng để đổi một web identity token hợp lệ lấy role session/temporary AWS credentials.

Flow:

```text
OIDC Token
     ↓
AssumeRoleWithWebIdentity
     ↓
AWS STS
     ↓
IAM Role Session
```

---

# 11. `aud` — Audience

Claim:

```text
aud
```

trả lời:

> Token này được phát hành để sử dụng với đối tượng/service nào?

Trong GitHub → AWS flow thường là:

```text
sts.amazonaws.com
```

Trust policy kiểm tra:

```text
aud == sts.amazonaws.com
```

---

# 12. `sub` — Subject

`sub` rất quan trọng vì nó có thể giúp giới hạn workflow nào được assume role.

Ví dụ:

```text
repo:OWNER/cloudshop:ref:refs/heads/main
```

Tách ra:

```text
repo
 ↓
OWNER/cloudshop
 ↓
ref
 ↓
refs/heads/main
```

Tư duy:

```text
GitHub
  ↓
đúng repository?
  ↓
đúng branch?
  ↓
Role allowed
```

---

# 13. Tại sao cần giới hạn repository/branch?

Nếu trust policy quá rộng:

```text
GitHub OIDC
    ↓
nhiều workflow không cần thiết
    ↓
Role
```

thì trust boundary lớn hơn yêu cầu.

CloudShop muốn:

```text
Expected CloudShop workflow/context
              ↓
CloudShopGitHubActionsRole
```

Đây là một phần của nguyên tắc:

```text
Least Privilege
```

Không chỉ permission cần giới hạn.

Trust relationship cũng cần giới hạn.

---

# 14. AWS STS là gì?

STS = Security Token Service.

Nhiệm vụ trong flow này:

```text
OIDC Token
    ↓
STS
    ↓
Validate identity/trust conditions
    ↓
Assume IAM Role
    ↓
Temporary Credentials
```

STS không phải nơi lưu Docker image.

STS cũng không phải IAM Role.

Nó là service tham gia vào việc cấp temporary security credentials.

---

# 15. Temporary Credentials

Sau khi assume role thành công, workflow nhận temporary AWS credentials.

Về mặt khái niệm gồm:

```text
Access Key ID
Secret Access Key
Session Token
Expiration
```

Điểm quan trọng:

```text
Temporary
```

Credential có thời hạn.

Flow:

```text
Workflow starts
      ↓
Assume Role
      ↓
Temporary Credentials
      ↓
Use AWS APIs
      ↓
Credentials expire
```

---

# 16. Full Authentication Flow

Đây là flow quan trọng nhất của phase này:

```text
GitHub Actions
      │
      │ request token
      ▼
GitHub OIDC
      │
      │ JWT / OIDC token
      ▼
AWS STS
      │
      │ AssumeRoleWithWebIdentity
      ▼
IAM Trust Policy
      │
      ├── Provider correct?
      ├── Audience correct?
      └── Subject correct?
              │
             YES
              │
              ▼
CloudShopGitHubActionsRole
              │
              ▼
Temporary Credentials
              │
              ▼
GitHub Runner
              │
              ▼
AWS APIs
```

---

# 17. GitHub Actions Configuration

Workflow cần:

```yaml
permissions:
  id-token: write
  contents: read
```

Sau đó:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v5
  with:
    role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/CloudShopGitHubActionsRole
    aws-region: ap-southeast-1
```

Flow:

```text
configure-aws-credentials
          ↓
request GitHub OIDC token
          ↓
call AWS STS
          ↓
assume role
          ↓
temporary credentials
          ↓
available to later AWS steps
```

---

# 18. `id-token: write`

```yaml
permissions:
  id-token: write
```

Điều này cho phép workflow request GitHub OIDC token.

Nó KHÔNG có nghĩa:

```text
GitHub được quyền AWS Admin ❌
```

Nó chỉ là một phần để workflow lấy identity token.

AWS permissions cuối cùng vẫn phụ thuộc vào:

```text
Trust Policy
+
IAM Permission Policy
```

---

# 19. Verify AWS Identity

Sau khi configure credentials:

```bash
aws sts get-caller-identity
```

Command này rất hữu ích để kiểm tra:

> AWS đang nhìn workflow này dưới identity nào?

Output có dạng:

```json
{
  "UserId": "...",
  "Account": "...",
  "Arn": "arn:aws:sts::<ACCOUNT_ID>:assumed-role/CloudShopGitHubActionsRole/..."
}
```

Điểm quan trọng:

```text
assumed-role/CloudShopGitHubActionsRole
```

cho thấy workflow đang hoạt động dưới một role session.

---

# 20. Trust Policy vs Permission Policy

Đây là phần PHẢI nhớ.

## Trust Policy

Trả lời:

```text
WHO can assume the role?
```

Ví dụ:

```text
GitHub CloudShop
       ↓
main
       ↓
CloudShopGitHubActionsRole
```

## Permission Policy

Trả lời:

```text
WHAT can the role do?
```

Ví dụ:

```text
CloudShopGitHubActionsRole
        ↓
Amazon ECR
        ↓
Push Image
```

Full flow:

```text
GitHub
  ↓
Trust Policy
  ↓
Can Assume Role?
  ↓
YES
  ↓
IAM Role
  ↓
Permission Policy
  ↓
Can Push ECR?
```

---

# 21. Authentication vs Authorization

Có thể tư duy:

```text
Authentication
= Bạn là ai / identity nào đang truy cập?

Authorization
= Identity đó được phép làm gì?
```

CloudShop:

```text
GitHub
 ↓
OIDC
 ↓
STS
 ↓
IAM Role
```

giải quyết identity/role assumption.

Sau đó:

```text
IAM Role
 ↓
Permission Policy
 ↓
ECR
```

kiểm soát authorization đối với AWS resource/action.

---

# 22. Ví dụ Debug — OIDC lỗi

Giả sử step:

```text
Configure AWS credentials
```

fail.

Tư duy kiểm tra:

```text
GitHub OIDC token
      ↓
OIDC Provider
      ↓
Trust Policy
      ↓
repo / branch / aud conditions
```

Chưa cần debug Docker hay ECR push.

Vì pipeline chưa đi đến đó.

---

# 23. Ví dụ Debug — ECR Permission lỗi

Giả sử:

```text
Configure AWS credentials   ✅
aws sts get-caller-identity ✅
ECR operation               ❌
```

Điều này cho biết OIDC/role assumption đã hoạt động.

Vấn đề có khả năng nằm ở:

```text
IAM Permission Policy
        ↓
ECR permissions/resource
```

Không nên sửa Trust Policy ngay khi role đã assume thành công.

---

# 24. Cách đọc `AccessDenied`

Đừng thấy:

```text
AccessDenied
```

rồi kết luận ngay:

```text
OIDC sai
```

Hãy hỏi:

> Access denied ở action nào?

Ví dụ:

```text
AssumeRoleWithWebIdentity denied
```

→ tập trung:

```text
OIDC / Trust Policy
```

Nếu:

```text
ecr:GetAuthorizationToken denied
```

→ role đã đi tới ECR nhưng thiếu ECR authentication permission.

Nếu:

```text
ecr:PutImage denied
```

→ role thiếu permission push image hoặc resource scope không đúng.

Tư duy:

```text
Error Action
     ↓
Xác định layer
     ↓
Debug layer đó
```

---

# 25. Security Model của CloudShop

CloudShop không muốn:

```text
GitHub
 ↓
Long-lived AWS key
 ↓
Broad AWS permissions
```

Mục tiêu cuối:

```text
GitHub Workflow
      ↓
OIDC
      ↓
Restricted Trust Policy
      ↓
Temporary IAM Role Session
      ↓
Least-Privilege Permission
      ↓
Required AWS Resource Only
```

---

# 🧠 Kiến thức cốt lõi cần note

```text
OIDC
= cơ chế federation/identity giữa GitHub và AWS

JWT
= token chứa claims + signature

iss
= issuer

aud
= audience

sub
= subject

OIDC Provider
= identity provider được cấu hình trong AWS IAM

STS
= cấp temporary security credentials

AssumeRoleWithWebIdentity
= đổi web identity token lấy role session

IAM Role
= identity được assume

Trust Policy
= WHO được assume role

Permission Policy
= role được làm WHAT

Temporary Credentials
= credential có thời hạn
```

Flow bắt buộc nhớ:

```text
GitHub
  ↓
OIDC Token
  ↓
AWS STS
  ↓
Trust Policy
  ↓
IAM Role
  ↓
Temporary Credentials
  ↓
Permission Policy
  ↓
AWS Resource
```

---

# 📌 CloudShop Flow

Trong CloudShop hiện tại:

```text
GitHub Actions
      ↓
GitHub OIDC
      ↓
AWS STS
      ↓
CloudShopGitHubActionsRole
      ↓
Temporary Credentials
      ↓
Amazon ECR
```

Sau này cùng cơ chế này có thể được mở rộng để pipeline thực hiện deployment tới ECS, nhưng permissions phải được thiết kế theo đúng nhu cầu của pipeline.

GitHub nói:
"Tôi là workflow của CloudShop main"
            ↓
      OIDC Token
            ↓
AWS STS nhận token
            ↓
Trust Policy:
"Workflow này có được mượn Role không?"
            ↓
           YES
            ↓
CloudShopGitHubActionsRole
            ↓
STS cấp credential tạm
            ↓
GitHub dùng credential đó
            ↓
Permission Policy:
"Role được phép làm gì?"
            ↓
           ECR