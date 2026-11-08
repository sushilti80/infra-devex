# Self-Service Infrastructure Catalog - Vue 3 Edition

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](./VERSION)
[![Node](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org)
[![Vue](https://img.shields.io/badge/vue-3.4+-42b883.svg)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.0+-3178c6.svg)](https://www.typescriptlang.org)

**Web-based self-service platform for provisioning and managing Azure infrastructure using standardized Terraform modules with Vue 3.**

## Set up your own installation

The portal stores infrastructure metadata in a separate GitHub repository, not a
database. Start with [service-catalog/README.md](service-catalog/README.md) to set up
that repository and its copied workflows. Configure repository names, Entra ID,
Azure subscriptions in `data/environments.json`, and optional AKS registry/DNS
settings for your installation. No organization-specific runtime defaults are supplied.

Before publishing, complete the [public release checklist](docs/OPEN-SOURCE-SETUP.md).
This working-tree cleanup does not sanitize Git history or approve licensing.

---

## What's New — Edit Infrastructure (v2.2.0)

Existing applications can now be modified directly from the **Installed Apps** page.

- Navigate to **Installed Apps** and click the **pencil icon** next to any deployed app.
- The Custom Infrastructure wizard opens pre-loaded with the app's current modules, RBAC relationships, and metadata.
- Modify what you need (add/remove modules, update RBAC) and re-deploy.

The manual "Load from existing app" picker inside the Custom Infrastructure wizard has been removed. The **Edit** button on the Installed Apps page is the single, intentional entry point.

**Operator note:** Deploy images with `--build-arg VITE_ENABLE_CATALOG_PREFILL=true` to enable this feature. See [docs/EDIT-INFRASTRUCTURE-GUIDE.md](docs/EDIT-INFRASTRUCTURE-GUIDE.md) for full details.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 18+ (20+ recommended)
- **npm**: 8+
- **Podman** or **Docker**: For containerized deployment
- **GitHub Apps**: Two GitHub Apps configured (Infrastructure + Code Deployment)
- **Azure**: Active Azure subscription with appropriate permissions
- **Microsoft Entra ID**: App registration for authentication (see [Authentication Setup](#authentication-setup))

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd self-service-infra

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure your credentials in .env:
# GitHub Apps:
# - GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_PRIVATE_KEY_PATH
# - GITHUB_CODE_APP_ID, GITHUB_CODE_INSTALLATION_ID, GITHUB_CODE_APP_PRIVATE_KEY_PATH
#
# Entra ID Authentication:
# - AZURE_AD_CLIENT_ID, AZURE_AD_TENANT_ID
# - VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_AUTHORITY

# See Authentication Setup section below for detailed configuration
```

---

## 🎯 Development Modes

### Mode 1: Vue 3 Development (Recommended - with HMR)

**Best for active frontend development** with hot module replacement.

```bash
# Terminal 1: Start Express Backend
npm run dev
# Express API server runs on http://localhost:3000

# Terminal 2: Start Vite Dev Server
npm run dev:client
# Vite dev server with HMR runs on http://localhost:5173
# Proxies API requests to :3000

# Open browser at: http://localhost:5173
```

**Features:**
- ✅ Hot Module Replacement (instant updates)
- ✅ TypeScript type checking
- ✅ Fast component refresh
- ✅ Source maps for debugging

---

### Mode 2: Production Build (Testing Production Build Locally)

**Best for testing production builds** before deployment.

```bash
# Step 1: Build Vue app
npm run build:client
# Creates production-optimized dist/ folder

# Step 2: Start Express with production build
USE_VUE=true npm start
# Serves built Vue app from dist/ on http://localhost:3000

# Open browser at: http://localhost:3000
```

**Features:**
- ✅ Production-optimized bundles
- ✅ Minified and tree-shaken code
- ✅ Same environment as production
- ⚠️  Requires rebuild for changes

---

## 📦 Project Structure

```
self-service-infra/
├── srcV2/                      # Vue 3 Application (TypeScript)
│   ├── components/             # Vue components
│   │   ├── common/            # Shared components (Header, Footer)
│   │   └── modals/            # Modal components (StatusModal)
│   ├── pages/                 # Page components (routes)
│   ├── stores/                # Pinia stores (state management)
│   ├── composables/           # Reusable composition functions
│   ├── services/              # API service layer (axios)
│   ├── types/                 # TypeScript type definitions
│   ├── styles/                # Global styles (Tailwind)
│   ├── App.vue                # Root Vue component
│   └── main.ts                # Vue app entry point
│
├── server.js                   # Express server (Node.js 20+)
├── config.js                   # Backend configuration
├── routes/                     # Express API routes
│   └── api.js                 # 28+ REST API endpoints
├── services/                   # Backend services
│   ├── githubService.js       # GitHub API integration (Octokit)
│   ├── infrastructureService.js # Infrastructure orchestration
│   ├── aksService.js          # Azure Kubernetes Service
│   └── databaseService.js     # Database service (placeholder)
├── middleware/                 # Express middleware
│   ├── auth.js                # Authentication middleware
│   └── verifyWebhook.js       # GitHub webhook verification
├── utils/                      # Utility functions
│   ├── logger.js              # Winston logger
│   └── promptBuilder.js       # Prompt utilities
├── data/                       # Static data
│   ├── modules.json           # Terraform module definitions
│   ├── templates.json         # Infrastructure templates
│   └── agents.json            # AI agent definitions
│
├── index.html                  # Vue app HTML entry point
├── vite.config.ts             # Vite configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── tsconfig.json              # TypeScript configuration
├── vitest.config.ts           # Vitest test configuration
│
├── Dockerfile.vue             # Production Docker image (Vue)
├── package.json               # Node.js dependencies
└── docs/                      # Architecture documentation
    ├── Architecture.md        # Complete architecture spec
    ├── Architecture-Quick-Reference.md
    └── Vue-Architecture-Diagram.md
```

---

## 🏗️ Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Vue 3.4+ (Composition API) | Modern reactive UI framework |
| **State** | Pinia 2.1+ | Centralized state management |
| **Language** | TypeScript 5.0+ | Type safety and better DX |
| **Styling** | Tailwind CSS 3.x | Utility-first CSS framework |
| **Build** | Vite 5.0+ | Fast dev server & bundler |
| **Testing** | Vitest + @vue/test-utils | Unit & component testing |
| **Backend** | Node.js 20+ & Express 4.18+ | RESTful API server |
| **Auth** | Dual GitHub Apps | Infrastructure & Code deployment |
| **Data** | GitHub (`docs/metadata/`) | GitOps - No database |
| **CI/CD** | GitHub Actions + Terraform | Infrastructure workflows |
| **Deploy** | Docker + Kubernetes (AKS) | Container orchestration |

### Core Architecture Patterns

1. **GitHub as Database**
   - Metadata stored in GitHub repository (`docs/metadata/`)
   - Version control provides audit trail
   - No traditional database overhead

2. **Dual GitHub Apps**
   - Infrastructure App: Manages infrastructure workflows
   - Code App: Manages application code deployment
   - Least privilege security model

3. **Correlation ID Tracking**
   - End-to-end request tracing
   - Format: `cid-{timestamp}-{random}`
   - Flows through: Browser → API → GitHub → Logs

4. **Stateless Backend**
   - Express API is stateless (scales horizontally)
   - All state in GitHub or client-side (Pinia stores)

5. **Workflow Polling**
   - Client polls workflow status via correlation ID
   - Real-time UX without WebSockets

---

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# TypeScript type checking
npm run type-check
```

### Test Structure

```
srcV2/
├── components/
│   └── common/
│       ├── SharedHeader.vue
│       └── SharedHeader.spec.ts    # Component tests
├── composables/
│   ├── useApi.ts
│   └── useApi.spec.ts              # Composable tests
└── stores/
    ├── infrastructure.ts
    └── infrastructure.spec.ts      # Store tests
```

**Coverage Goals:**
- Components: 80%+
- Composables: 90%+
- Services: 85%+

---

## 🐳 Docker Deployment

### Production Build with Podman

```bash
# Build production image
podman build -f Dockerfile.vue -t self-service-infra:latest .

# Run container
podman run -d \
  --name self-service-infra \
  -p 3000:3000 \
  -e GITHUB_APP_ID=your_app_id \
  -e GITHUB_INSTALLATION_ID=your_installation_id \
  -v /path/to/github-key.pem:/app/secrets/github-key.pem:ro \
  self-service-infra:latest

# Check health
curl http://localhost:3000/health

# View logs
podman logs self-service-infra
```

### Validate Docker Image

```bash
# Run comprehensive validation
./validate-dockerfile-vue.sh

# Validation checks:
# ✅ Multi-stage build structure
# ✅ Vue 3 build from srcV2
# ✅ Correct environment variables (USE_VUE=true)
# ✅ dist/ folder with compiled assets
# ✅ Health endpoint responding
# ✅ Container runtime validation
```

### Docker Multi-Stage Build

The `Dockerfile.vue` uses a two-stage build:

1. **Stage 1 (frontend-builder):**
   - Installs all dependencies (including devDependencies)
   - Builds Vue 3 app: `npm run build:client`
   - Output: `dist/` folder with optimized bundles

2. **Stage 2 (production):**
   - Installs production dependencies only
   - Copies built `dist/` from Stage 1
   - Copies backend code (server.js, routes/, services/, etc.)
   - Sets `USE_VUE=true` and `NODE_ENV=production`
   - Exposes port 3000
   - Health check: `/health` endpoint

**Image Size:** ~277 MB (optimized)

---

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Node Environment
NODE_ENV=production
PORT=3000
USE_VUE=true

# GitHub Infrastructure App
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=78901
GITHUB_PRIVATE_KEY_PATH=/app/secrets/github-app.pem

# GitHub Code Deployment App
GITHUB_CODE_APP_ID=234567
GITHUB_CODE_INSTALLATION_ID=89012
GITHUB_CODE_APP_PRIVATE_KEY_PATH=/app/secrets/github-code-app.pem

# GitHub Repositories
GITHUB_SERVICE_REPO=organization/service-catalog
GITHUB_MODULES_REPO=organization/terraform-modules
GITHUB_INFRA_LIVE_REPO=organization/infrastructure-live
AKS_FLUX_REPO=organization/flux-config

# Azure Configuration
AZURE_SUBSCRIPTION_IDS='{"devsand":"subscription-id-1","sand":"subscription-id-2"}'
AZURE_DEFAULT_SUBSCRIPTION=subscription-id-default

# Microsoft Entra ID Authentication (Azure AD)
AZURE_AD_CLIENT_ID=your-application-client-id
AZURE_AD_TENANT_ID=your-tenant-id

# Frontend Entra ID (MSAL.js)
VITE_ENTRA_CLIENT_ID=your-application-client-id
VITE_ENTRA_TENANT_ID=your-tenant-id
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/your-tenant-id

# Webhook
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Terraform
TERRAFORM_BRANCH=main
SERVICE_CATALOG_BRANCH=main

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Azure Subscription Configuration

Edit `data/environments.json` to add, remove, or change environments. This file is the
single source of truth for environment IDs, Azure subscriptions, defaults, and feature
availability; the backend and Vue application load the catalog through `/api/environments`.

```json
{
  "environments": [
    {
      "id": "example",
      "displayName": "Example Environment",
      "subscriptionId": "<azure-subscription-id>",
      "enabled": true,
      "features": {
        "customInfra": true,
        "templates": true,
        "aks": false,
        "secrets": false
      }
    }
  ],
  "defaultEnvironment": "example",
  "defaultSubscriptionId": "<azure-subscription-id>"
}
```

---

## � Authentication Setup

### Microsoft Entra ID Configuration

The application requires a Microsoft Entra ID (Azure AD) app registration for user authentication.

#### Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com) → **Entra ID** → **App Registrations**
2. Click **New registration**
3. Configure:
   - **Name**: `Self-Service Infrastructure Catalog`
   - **Supported account types**: Single tenant
   - **Redirect URI**: Leave empty (will add later)
4. Click **Register**

#### Step 2: Configure Application

After registration, note these values from the **Overview** page:
- **Application (client) ID**: Copy to `.env` as `AZURE_AD_CLIENT_ID` and `VITE_ENTRA_CLIENT_ID`
- **Directory (tenant) ID**: Copy to `.env` as `AZURE_AD_TENANT_ID` and `VITE_ENTRA_TENANT_ID`

#### Step 3: Set Application ID URI

1. Go to **Expose an API** → Click **Add** next to Application ID URI
2. Accept default: `api://{CLIENT_ID}` (e.g., `api://ee62dfaa-bd92-4f1d-888d-16e7e81f8e18`)
3. Click **Save**

#### Step 4: Add API Scope

1. Under **Expose an API** → Click **Add a scope**
2. Configure:
   - **Scope name**: `access_as_user`
   - **Who can consent**: Admins and users
   - **Admin consent display name**: `Access application as user`
   - **Admin consent description**: `Allows the app to access the self-service infrastructure catalog as the signed-in user`
   - **User consent display name**: `Access the app as you`
   - **User consent description**: `Allows you to use the self-service infrastructure catalog`
   - **State**: Enabled
3. Click **Add scope**

#### Step 5: Configure Redirect URIs

1. Go to **Authentication** → **Add a platform** → **Single-page application**
2. Add redirect URIs for each environment:
   - **Local development**: `http://localhost:3001`
   - **Local dev server**: `http://localhost:5174` (if using `npm run dev:client`)
   - **Staging**: `https://your-staging-domain.com`
   - **Production**: `https://your-production-domain.com`
3. Under **Implicit grant and hybrid flows**: Leave both unchecked (we use Authorization Code Flow with PKCE)
4. Click **Save**

#### Step 6: Grant User Consent (One-Time Setup)

Users need to consent to the API scope. For testing:

```bash
# Login with Azure CLI
az login

# Grant consent by acquiring a token
az account get-access-token --resource {YOUR_CLIENT_ID}
# Example: az account get-access-token --resource ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
```

This grants consent for your user account to access the API.

#### Step 7: Update Environment Variables

Update `.env` with your Entra ID values:

```bash
# Backend JWT validation
AZURE_AD_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
AZURE_AD_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9

# Frontend MSAL configuration
VITE_ENTRA_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
VITE_ENTRA_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/c32ce235-4d9a-4296-a647-a9edb2912ac9
```

#### Step 8: Test Authentication

```bash
# Start the application
USE_VUE=true npm start

# Open browser at http://localhost:3001
# Click "Login with Entra ID" button
# Sign in with your work account
# After redirect, you should be logged in with your name/email displayed
```

**Expected Flow:**
1. Click login → Redirect to Microsoft login
2. Sign in with work account
3. Redirect back to app
4. User authenticated, API calls work
5. User info (name, email) displays in header

**Troubleshooting:**
- **401 Unauthorized**: Check `AZURE_AD_CLIENT_ID` matches app registration
- **Cross-origin error**: Ensure redirect URI is registered as **SPA** (not Web)
- **Invalid audience**: Backend expects audience = `{CLIENT_ID}` or `api://{CLIENT_ID}`
- **Consent required**: Run `az account get-access-token --resource {CLIENT_ID}` to grant consent

For detailed troubleshooting, see [docs/entra-id-integration-plan.md](docs/entra-id-integration-plan.md)

---

## �📡 API Endpoints

### Infrastructure Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/templates` | GET | Get available infrastructure templates |
| `/api/modules` | GET | Get available Terraform modules |
| `/api/installed-apps` | GET | Get all installed applications |
| `/api/custom` | POST | Deploy custom infrastructure |
| `/api/template` | POST | Deploy from template |
| `/api/delete` | POST | Delete infrastructure |
| `/api/promote` | POST | Promote to production |
| `/api/label` | POST | Label application (Live/Experimental) |

### AKS Deployment

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/aks-deploy` | POST | Deploy application to AKS |
| `/api/aks-status/:workflowId` | GET | Get deployment status by workflow ID |
| `/api/aks-status-by-correlation/:correlationId` | GET | Get status by correlation ID |
| `/api/aks-apps/:environment?` | GET | List deployed AKS applications |

### Workflow Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status/:correlationId` | GET | Get workflow status by correlation ID |

### Health Check

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Container health check |

**Full API Documentation:** See [docs/Architecture.md#api-architecture](./docs/Architecture.md#api-architecture)

---

## 🔐 Security

### Authentication

#### Microsoft Entra ID (Azure AD)

The application uses **Microsoft Entra ID** for user authentication with OAuth 2.0 Authorization Code Flow with PKCE.

**Features:**
- ✅ Single Sign-On (SSO) with Microsoft work accounts
- ✅ Secure token-based API authentication (JWT)
- ✅ Automatic token refresh (silent renewal)
- ✅ Session persistence across page reloads
- ✅ Role-based access control (RBAC) ready

**Authentication Flow:**
1. User clicks "Login with Entra ID" → Redirects to Microsoft login
2. User signs in with work account → Microsoft issues tokens
3. App redirects back with authorization code
4. Frontend acquires access token for API calls
5. Backend validates JWT signature and audience
6. User identity extracted from token (email, name, roles)

**Protected Resources:**
- All infrastructure management endpoints require authentication
- Public endpoints: `/api/templates`, `/api/modules`
- Protected endpoints: `/api/installed-apps`, `/api/custom`, `/api/delete`, etc.

#### GitHub Apps

- **Dual-app pattern:** Separate apps for infrastructure and code operations
- **JWT Tokens:** Short-lived tokens for GitHub API authentication
- **Webhook Verification:** HMAC-SHA256 signature verification

### Input Validation

- **Backend:** `express-validator` for all API inputs
- **Frontend:** Form validation with TypeScript type checking
- **Kubernetes:** Naming convention validation

### Secrets Management

- **Environment Variables:** Sensitive config in `.env`
- **Kubernetes Secrets:** Private keys mounted as volumes
- **No Hardcoding:** All secrets loaded from environment

### Network Security

- **CORS:** Configured allowed origins
- **HTTPS:** TLS termination at ingress
- **Non-root User:** Docker container runs as non-root

---

## 🚢 Deployment to Production

### Step 1: Build and Validate

```bash
# Build production image
podman build -f Dockerfile.vue -t self-service-infra:latest .

# Validate image
./validate-dockerfile-vue.sh
```

### Step 2: Push to Azure Container Registry

```bash
# Login to ACR
az acr login --name yourregistry

# Tag image
podman tag self-service-infra:latest yourregistry.azurecr.io/self-service-infra:latest

# Push image
podman push yourregistry.azurecr.io/self-service-infra:latest
```

### Step 3: Deploy to Kubernetes

```bash
# Update deployment with new image
kubectl set image deployment/self-service-infra \
  self-service-infra=yourregistry.azurecr.io/self-service-infra:latest \
  -n self-service-test

# Verify deployment
kubectl rollout status deployment/self-service-infra -n self-service-test

# Check pods
kubectl get pods -n self-service-test

# Check logs
kubectl logs -f deployment/self-service-infra -n self-service-test
```

### Step 4: Configure Ingress

```yaml
# kubernetes/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: self-service-ingress
  namespace: self-service-test
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - self-service.example.com
    secretName: self-service-tls
  rules:
  - host: self-service.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: self-service-test-svc
            port:
              number: 80
```

**Deployment Guide:** See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

---

## 🐛 Troubleshooting

- [Datadog log investigation runbook](./.runbooks/datadog-logs.md): scoped queries and safe evidence collection for humans and AI agents.
- [Secrets encryption failure runbook](./.runbooks/secrets-encryption.md): runtime-image, SOPS, and Key Vault triage.

### Issue: "GitHub client not initialized"

**Solution:**
- Check GitHub App credentials in `.env`
- Verify private key files exist at configured paths
- Check server logs: `podman logs <container-name>`

### Issue: "Workflow not triggering"

**Solution:**
- Verify GitHub App has `workflow_dispatch` permissions
- Check correlation ID is being passed correctly
- Verify workflow file exists in target repository

### Issue: "Metadata not loading"

**Solution:**
- Verify GitHub App has read access to service-catalog repository
- Check `docs/metadata/` folder exists with JSON files
- Verify JSON schema is correct

### Issue: "Vue app not loading (blank page)"

**Solution:**
- Check `USE_VUE=true` is set in environment
- Verify `dist/` folder exists with built files
- Check browser console for JavaScript errors
- Verify `index.html` has `<div id="app">`

### Issue: "Hot Module Replacement not working"

**Solution:**
- Ensure Vite dev server is running on port 5173
- Check proxy configuration in `vite.config.ts`
- Verify Express backend is running on port 3000
- Clear browser cache and restart dev servers

---

## 📚 Documentation

### Architecture Documentation

| Document | Description |
|----------|-------------|
| [Architecture.md](./docs/Architecture.md) | Complete architecture specification (1,893 lines) |
| [Architecture-Quick-Reference.md](./docs/Architecture-Quick-Reference.md) | Quick reference guide with key patterns |
| [Vue-Architecture-Diagram.md](./docs/Vue-Architecture-Diagram.md) | Vue 3 architecture and dev modes |
| [Migration-Guide-Vue.js.md](./docs/Migration-Guide-Vue.js.md) | Complete Vue 3 migration guide |

### Implementation Documentation

| Document | Description |
|----------|-------------|
| [srcV2/README.md](./srcV2/README.md) | Vue 3 implementation details |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Deployment procedures |
| [docs/TESTING.md](./docs/TESTING.md) | Testing guidelines |

---

## 🤝 Contributing

### Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes in `srcV2/` for frontend updates
3. Write tests for new components/composables
4. Run tests: `npm test`
5. Run type check: `npm run type-check`
6. Commit with descriptive message
7. Push and create pull request

### Code Style

- **TypeScript:** Strict mode enabled
- **Vue:** Composition API with `<script setup>`
- **CSS:** Tailwind utility classes (avoid custom CSS)
- **Formatting:** ESLint + Prettier (auto-format on save)

### Testing Guidelines

- Write tests before implementation (TDD)
- Component tests: Behavior over implementation
- Composables tests: 90%+ coverage
- Mock external dependencies (API calls, router)

---

## 📝 Scripts Reference

```json
{
  "start": "node server.js",                 // Production server
  "dev": "nodemon server.js",                 // Backend dev with auto-reload
  "dev:client": "vite",                       // Frontend dev with HMR
  "build:client": "vite build",               // Production build
  "preview": "vite preview",                  // Preview production build
  "test": "vitest",                           // Run tests
  "test:ui": "vitest --ui",                   // Tests with UI
  "test:coverage": "vitest --coverage",       // Coverage report
  "type-check": "vue-tsc --noEmit"            // TypeScript check
}
```

---

## 📊 Project Status

**Current Version:** 2.0.0  
**Status:** ✅ Production Ready (Vue 3)  
**Last Updated:** February 4, 2026

### Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Vue 3 Migration | ✅ Complete | All components migrated |
| Custom Infrastructure | ✅ Production | Fully functional |
| Template Deploy | ✅ Production | Pre-configured templates |
| AKS Deployment | ✅ Production | Kubernetes integration |
| Installed Apps | ✅ Production | GitHub metadata |
| RBAC Manager | ✅ Production | Role-based access control |
| Docker Build | ✅ Validated | Multi-stage build |
| Kubernetes Deploy | ✅ Production | AKS deployment |
| Health Checks | ✅ Production | Container health monitoring |

---

## 📞 Support

- **Architecture Questions:** See [docs/Architecture.md](./docs/Architecture.md)
- **API Questions:** See [docs/Architecture-Quick-Reference.md](./docs/Architecture-Quick-Reference.md)
- **Issues:** Create GitHub issue with correlation ID from logs
- **Security Issues:** Contact security team directly

---

## 📄 License

ISC License

---

## 🙏 Acknowledgments

Built with:
- **Vue 3** - Progressive JavaScript Framework
- **Vite** - Next Generation Frontend Tooling
- **Pinia** - The Vue Store
- **Tailwind CSS** - A utility-first CSS framework
- **TypeScript** - JavaScript with syntax for types
- **Express** - Fast, unopinionated web framework for Node.js
- **Octokit** - GitHub REST API client for JavaScript

---

**Made with ❤️ by the DevOps Team**
