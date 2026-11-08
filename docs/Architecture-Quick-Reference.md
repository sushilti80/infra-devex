# SelfService Infrastructure Catalog - Quick Reference

**Version**: 2.0  
**Last Updated**: 2024-01-20  

> For comprehensive architecture documentation, see [Architecture.md](./Architecture.md)

---

## System at a Glance

**Purpose**: Self-service platform for provisioning and managing Azure infrastructure using Terraform modules

**Key Technology**: Node.js + Express + Vanilla JavaScript SPA + GitHub Actions + Terraform + AKS

**Data Storage**: **No Database** - GitHub repository (`docs/metadata/`) is the source of truth

---

## 5 Core Architecture Patterns

### 1. GitHub as Database
- Application metadata stored as JSON files in `docs/metadata/`
- Version control provides audit trail
- No database operations overhead
- Eventual consistency (<30s acceptable)

### 2. Multi-GitHub-App Pattern
- **Infrastructure App**: Manages workflows, infrastructure PRs, metadata operations
- **Code App**: Manages AKS deployments, application code
- Least privilege security, failure isolation

### 3. Correlation ID Tracking
- Generate `correlationId = cid-{timestamp}-{random}` on every request
- Thread through: Browser → API → Services → GitHub workflow → Status polling → Logs
- End-to-end traceability for debugging and auditing

### 4. SPA Navigation (No Router)
- Single HTML file with multiple `.page` divs
- Toggle `.active` class via `navigateToPage()` function
- No React, Vue, or router libraries
- Fast, simple, explicit state management

### 5. Workflow Polling
- Client polls `GET /api/workflow-status?correlationId=X` every 10 seconds
- Response: `{status: "pending|in_progress|success|failure", message, prUrl, workflowUrl, percentage}`
- Stateless backend (scales horizontally)
- Real-time UX without webhooks

---

## Component Map

```
SelfService Infrastructure Catalog
│
├── Frontend (public/)
│   ├── index.html - SPA with 5 pages + 5 modals
│   ├── js/app.js - Core navigation, forms, polling
│   ├── js/rbac-manager.js - RBAC relationship builder
│   └── css/styles.css - Styling
│
├── Backend (src/)
│   ├── server.js - Express entry point + correlation ID middleware
│   ├── routes/api.js - 28 REST API endpoints
│   ├── services/
│   │   ├── githubService.js - Dual Octokit clients, workflow triggering
│   │   ├── infrastructureService.js - Template/module management
│   │   ├── aksService.js - AKS deployment workflows
│   │   ├── databaseService.js - Mock/optional (not used)
│   │   └── hclParser.js - Terraform parsing
│   ├── middleware/verifyWebhook.js - GitHub webhook verification
│   └── utils/logger.js - Winston logger with correlation IDs
│
├── Configuration
│   ├── config.js - GitHub Apps, Azure subscriptions, AKS settings
│   ├── data/templates.json - Pre-built infrastructure templates
│   └── data/modules.json - Terraform module definitions
│
├── Deployment
│   ├── Dockerfile - Node.js 20 Alpine, non-root user, health checks
│   ├── kubernetes/ingress.yaml - NGINX ingress configuration
│   └── .github/workflows/ - CI/CD pipelines (not in this repo)
│
└── GitHub Integration
    ├── service-catalog - Metadata storage, infrastructure workflows
    ├── flux-config - Kubernetes manifests, AKS GitOps
    └── terraform-modules - Reusable Terraform modules
```

---

## API Quick Reference

### Infrastructure Management
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/templates` | GET | Get available templates |
| `/api/modules` | GET | Get available Terraform modules |
| `/api/installed-apps` | GET | Get all installed applications from GitHub metadata |
| `/api/custom` | POST | Build custom infrastructure with selected modules |
| `/api/template` | POST | Deploy from pre-defined template |
| `/api/delete` | POST | Delete infrastructure |
| `/api/promote` | POST | Promote infrastructure to production |
| `/api/label` | POST | Label application as Live/Experimental |

### AKS Deployment
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/aks-deploy` | POST | Deploy application to AKS |
| `/api/aks-status/:workflowId` | GET | Get AKS deployment status by workflow ID |
| `/api/aks-status-by-correlation/:correlationId` | GET | Get status by correlation ID |
| `/api/aks-apps/:environment?` | GET | List deployed AKS applications |

### Workflow Status
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/status/:correlationId` | GET | Get workflow status by correlation ID |

### RBAC Management
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rbac-relationships` | POST | Save RBAC relationships and trigger workflow |

---

## Data Flow Patterns

### Pattern 1: Custom Infrastructure Deployment
```
1. User fills form → Generate correlationId
2. POST /api/custom {projectName, modules[], environment, correlationId}
3. InfrastructureService.buildCustomInfrastructure()
4. GitHubService.triggerWorkflow("create-infrastructure.yaml")
5. GitHub Actions: terraform plan → create PR with correlationId in description
6. Client polls GET /api/status/{correlationId} every 10s
7. API searches PRs by correlationId → returns workflow status
8. On workflow completion: terraform apply → create metadata JSON in docs/metadata/
```

### Pattern 2: Fetch Installed Applications
```
1. Browser: GET /api/installed-apps
2. InfrastructureService.getInstalledApps()
3. GitHubService: List files in docs/metadata/
4. For each JSON file: Fetch content → Decode base64 → Parse JSON
5. Transform to frontend format {name, environment, owner, deployedAt, lifecycle, modules, age}
6. Sort by name → Return {success, count, data[], correlationId}
```

### Pattern 3: AKS Deployment
```
1. User fills AKS form → Generate correlationId
2. POST /api/aks-deploy {appname, namespace, image_name, image_tag, correlationId}
3. AKSService.deployToAks() → Validate K8s naming conventions
4. GitHubService.triggerWorkflow("generate-app.yaml" in flux-config repo)
5. GitHub Actions: Generate K8s manifests → Commit to flux repo
6. Flux operator detects change → Deploys to AKS cluster
7. Client polls GET /api/aks-status-by-correlation/{correlationId}
8. API returns {status, percentage, workflowUrl}
```

---

## Security Checklist

### Authentication
- ✅ Dual GitHub Apps with separate credentials
- ✅ Private keys stored as files (mounted volumes in K8s)
- ✅ JWT tokens for GitHub API authentication

### Input Validation
- ✅ Backend: express-validator for all inputs
- ✅ Frontend: Required fields, alphanumeric validation
- ✅ K8s naming conventions enforced

### Secret Management
- ✅ Environment variables for credentials
- ✅ Kubernetes secrets for sensitive data
- ✅ No secrets in code or logs

### Network Security
- ✅ CORS configured
- ✅ HTTPS termination at ingress
- ✅ Non-root Docker user

### Logging & Auditing
- ✅ Correlation ID in all logs
- ✅ Winston structured logging
- ✅ GitHub commit history as audit trail

---

## Deployment Checklist

### Prerequisites
- [x] GitHub App credentials configured (infrastructure + code)
- [x] Azure subscription IDs configured
- [x] Kubernetes cluster available (AKS)
- [x] Azure Container Registry accessible
- [x] Flux operator installed in AKS

### Deployment Steps
1. Build Docker image: `docker build -t self-service-infra:latest .`
2. Push to ACR: `docker push exampleregistry.azurecr.io/self-service-infra:latest`
3. Update K8s manifests in flux-config repository
4. Flux automatically deploys to AKS
5. Configure ingress: `kubectl apply -f kubernetes/ingress.yaml`
6. Verify health: `curl https://self-service.example.com/health`

### Environment Variables Required
```bash
# GitHub Apps
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=78901
GITHUB_PRIVATE_KEY_PATH=/app/secrets/github-app.pem
GITHUB_CODE_APP_ID=234567
GITHUB_CODE_INSTALLATION_ID=89012
GITHUB_CODE_PRIVATE_KEY_PATH=/app/secrets/github-code-app.pem

# Azure
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_SUBSCRIPTION_IDS={"devsand":"...", "sand":"..."}

# Repositories
GITHUB_SERVICE_REPO=organization/service-catalog
GITHUB_MODULES_REPO=organization/terraform-modules
AKS_FLUX_REPO=organization/flux-config
```

---

## Troubleshooting

### Issue: "GitHub client not initialized"
- Check GitHub App credentials in environment variables
- Verify private key files exist at configured paths
- Check application logs for initialization errors

### Issue: Workflow not triggering
- Verify GitHub App has workflow dispatch permissions
- Check correlation ID is being passed correctly
- Verify workflow file exists in target repository

### Issue: Metadata not loading
- Verify GitHub App has read access to service-catalog repository
- Check `docs/metadata/` folder exists and contains JSON files
- Verify JSON files have correct schema

### Issue: AKS deployment failing
- Verify Kubernetes naming conventions (lowercase, alphanumeric, hyphens)
- Check Flux operator is running in AKS cluster
- Verify image exists in Azure Container Registry
- Check flux-config repository has correct structure

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| API Response Time (95th percentile) | <500ms | - |
| Metadata Load (100 apps) | <2s | - |
| Workflow Status Poll | <1s | - |
| Page Load (3G) | <3s | - |
| GitHub API Calls | <5000/hour | - |
| Concurrent Users | 50+ | - |
| Uptime | 99.5% | - |

---

## Key Metrics to Monitor

### Application Health
- `/health` endpoint response time
- API error rate (5xx responses)
- Correlation ID coverage in logs

### GitHub Integration
- GitHub API rate limit remaining
- Workflow trigger success rate
- Workflow completion time (p50, p95, p99)

### User Experience
- Page load time
- Workflow status poll frequency
- Modal interaction success rate

### Infrastructure
- Pod restart count
- Memory usage
- CPU usage
- Network throughput

---

## Common Workflows

### Deploy New Infrastructure
1. Navigate to "Custom Infrastructure" or "Template Deploy"
2. Fill form (project name, environment, modules/template)
3. Click "Deploy" → Correlation ID generated
4. Status modal shows progress
5. Poll workflow status every 10s
6. On success: Infrastructure provisioned + metadata created
7. View in "Installed Apps" page

### Delete Infrastructure
1. Navigate to "Installed Apps"
2. Click "Delete" button for application
3. Confirm deletion
4. Workflow triggered with correlation ID
5. Poll status → terraform destroy
6. Metadata file removed from docs/metadata/

### Promote to Production
1. Navigate to "Installed Apps"
2. Click "Promote" button for application
3. Enter CR/JIRA number
4. Workflow triggered → create PR for production
5. Manual approval required
6. On merge: Infrastructure deployed to prod

### Deploy to AKS
1. Navigate to "AKS Deploy"
2. Fill form (app name, namespace, image name, image tag)
3. Click "Deploy" → Correlation ID generated
4. Workflow generates K8s manifests in flux-config
5. Flux operator deploys to AKS cluster
6. Poll status → view deployment progress

---

## Architecture Decision Records

### ADR-001: GitHub as Database
- **Decision**: Use GitHub repository for metadata storage
- **Rationale**: Version control, audit trail, no DB ops
- **Trade-offs**: Limited queries, API rate limits

### ADR-002: Dual GitHub Apps
- **Decision**: Separate apps for infrastructure vs. code
- **Rationale**: Least privilege, failure isolation
- **Trade-offs**: Configuration complexity

### ADR-003: No Frontend Router
- **Decision**: Manual page navigation via CSS classes
- **Rationale**: Simplicity, no dependencies
- **Trade-offs**: No URL routing, no browser history

### ADR-004: Client-Side Polling
- **Decision**: Client polls workflow status
- **Rationale**: Stateless backend, real-time UX
- **Trade-offs**: Network overhead, client-side state

### ADR-005: Correlation ID Tracking
- **Decision**: Generate UUID on client, thread through system
- **Rationale**: End-to-end traceability
- **Trade-offs**: Extra logging overhead

---

## Glossary

| Term | Definition |
|------|------------|
| **AKS** | Azure Kubernetes Service |
| **Correlation ID** | Unique identifier for tracing requests across system (format: `cid-{timestamp}-{random}`) |
| **Flux** | GitOps operator for Kubernetes |
| **GitOps** | Infrastructure-as-code approach using Git as source of truth |
| **HCL** | HashiCorp Configuration Language (Terraform) |
| **Octokit** | GitHub REST API client library |
| **SPA** | Single Page Application |
| **Terraform** | Infrastructure-as-code tool for provisioning |

---

## Quick Links

- [Full Architecture Documentation](./Architecture.md)
- [Entra ID Integration Plan](./entra-id-integration-plan.md)
- [Multi-Instance Feature](./multi-instance-feature.md)
- [Cross-Org Workflow Authentication](./cross-org-workflow-authentication.md)

---

**Need More Details?** See the comprehensive [Architecture.md](./Architecture.md) for:
- Detailed Mermaid diagrams for all flows
- Complete API endpoint documentation (all 28 endpoints)
- Service class methods and signatures
- Deployment configurations (Docker, Kubernetes)
- Security hardening details
- Quality attribute specifications
- Future enhancement roadmap

---

**Document Version**: 2.0  
**Maintained By**: DevOps Team  
**Last Review**: 2024-01-20
