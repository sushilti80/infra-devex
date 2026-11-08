# Production Deployment Guide - Vue.js Self-Service Catalog

**Version**: 2.0  
**Last Updated**: January 2026  
**Status**: Ready for Production Deployment

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Detailed Deployment Steps](#detailed-deployment-steps)
4. [Configuration](#configuration)
5. [Monitoring & Health Checks](#monitoring--health-checks)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts & Access
- Azure subscription with AKS access
- Azure Container Registry (ACR) credentials
- GitHub repository access
- GitHub App credentials (Infrastructure + Code deployment)
- kubectl configured for target AKS cluster

### Required Tools
```bash
# Verify installations
node --version    # Should be v20+
npm --version     # Should be v10+
docker --version  # Should be v24+
kubectl version   # Should be v1.28+
```

### Required Secrets (GitHub Repository)
Create these secrets in your GitHub repository settings:

```
ACR_USERNAME              - Azure Container Registry username
ACR_PASSWORD              - Azure Container Registry password
AZURE_CREDENTIALS         - Azure service principal credentials (JSON)
AKS_RESOURCE_GROUP        - Azure resource group name
AKS_CLUSTER_NAME          - AKS cluster name
```

---

## Quick Start

### Option 1: Manual Deployment (15 minutes)

```bash
# 1. Clone repository
git clone <repository-url>
cd self-service-infra

# 2. Install dependencies
npm ci --legacy-peer-deps

# 3. Build Vue.js application
npm run build:client

# 4. Build Docker image
docker build -t exampleregistry.azurecr.io/self-service-infra:v2 .

# 5. Push to ACR
docker push exampleregistry.azurecr.io/self-service-infra:v2

# 6. Deploy to AKS
kubectl apply -f kubernetes/

# 7. Verify deployment
kubectl get pods -n self-service-test
kubectl logs -f deployment/self-service-infra -n self-service-test
```

### Option 2: Automated CI/CD (5 minutes)

```bash
# 1. Configure GitHub secrets (see Prerequisites)

# 2. Push to main branch
git push origin main

# 3. Monitor GitHub Actions
# Go to: https://github.com/<org>/<repo>/actions

# 4. Verify deployment
curl https://self-service.example.com/health
```

---

## Detailed Deployment Steps

### Step 1: Environment Configuration (10 minutes)

#### Create Production Environment File

```bash
# Copy template
cp .env.production.template .env.production

# Edit with actual values
vim .env.production
```

**Required Variables**:
```bash
# API Configuration
VITE_API_BASE_URL=https://self-service.example.com/api
NODE_ENV=production
USE_VUE=true

# GitHub App (Infrastructure)
GITHUB_APP_ID=<your-app-id>
GITHUB_INSTALLATION_ID=<your-installation-id>
GITHUB_PRIVATE_KEY_PATH=/app/secrets/github-infra-key.pem

# GitHub App (Code Deployment)
GITHUB_CODE_APP_ID=<your-code-app-id>
GITHUB_CODE_INSTALLATION_ID=<your-code-installation-id>
GITHUB_CODE_PRIVATE_KEY_PATH=/app/secrets/github-code-key.pem

# Azure Configuration
AZURE_SUBSCRIPTION_IDS='{"devsand":"00000000-...","sand":"00000000-..."}'
AZURE_DEFAULT_SUBSCRIPTION=00000000-...

# Repository Configuration
GITHUB_SERVICE_REPO=organization/service-catalog
GITHUB_MODULES_REPO=organization/terraform-modules
AKS_FLUX_REPO=organization/flux-config

# Webhook Secret
GITHUB_WEBHOOK_SECRET=<your-webhook-secret>
```

#### Create Kubernetes Secrets

```bash
# Create namespace
kubectl create namespace self-service-test

# Create GitHub App secrets
kubectl create secret generic github-infra-private-key \
  --from-file=private-key=./path/to/github-infra.pem \
  -n self-service-test

kubectl create secret generic github-code-private-key \
  --from-file=private-key=./path/to/github-code.pem \
  -n self-service-test

kubectl create secret generic github-app-secrets \
  --from-literal=app-id=<infrastructure-app-id> \
  --from-literal=installation-id=<infrastructure-installation-id> \
  -n self-service-test

kubectl create secret generic github-code-app-secrets \
  --from-literal=app-id=<code-app-id> \
  --from-literal=installation-id=<code-installation-id> \
  -n self-service-test

# Create ACR pull secret
kubectl create secret docker-registry acr-secret \
  --docker-server=exampleregistry.azurecr.io \
  --docker-username=<acr-username> \
  --docker-password=<acr-password> \
  -n self-service-test
```

---

### Step 2: Build & Test Locally (15 minutes)

#### Build Vue.js Application

```bash
# Clean previous builds
rm -rf dist/ node_modules/.vite

# Install dependencies
npm ci --legacy-peer-deps

# Run TypeScript type check
npm run type-check

# Run tests
npm test -- --run

# Build production bundle
npm run build:client

# Verify build output
ls -lh dist/
# Expected output:
# index.html
# assets/index-<hash>.js
# assets/index-<hash>.css
```

#### Test Production Build Locally

```bash
# Start production server
USE_VUE=true npm start

# In another terminal, test endpoints
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}

curl http://localhost:3000
# Expected: HTML with Vue.js app

# Manual testing checklist:
# ✅ Navigate to http://localhost:3000
# ✅ Home page loads with 4 action cards
# ✅ Click "Custom Infrastructure" → form loads
# ✅ Click "Template Deploy" → form loads
# ✅ Click "Installed Apps" → apps list loads
# ✅ Click "AKS Deploy" → form loads
# ✅ Toggle dark mode → colors change
# ✅ No console errors
```

---

### Step 3: Build Docker Image (10 minutes)

```bash
# Build image with Vue.js
docker build -t exampleregistry.azurecr.io/self-service-infra:v2 .

# Test image locally
docker run -p 3000:3000 \
  -e USE_VUE=true \
  -e NODE_ENV=production \
  exampleregistry.azurecr.io/self-service-infra:v2

# Verify in browser
curl http://localhost:3000/health

# Check container logs
docker logs <container-id>
```

---

### Step 4: Push to Container Registry (5 minutes)

```bash
# Login to ACR
docker login exampleregistry.azurecr.io \
  -u <acr-username> \
  -p <acr-password>

# Tag image
docker tag self-service-infra:v2 \
  exampleregistry.azurecr.io/self-service-infra:v2

docker tag self-service-infra:v2 \
  exampleregistry.azurecr.io/self-service-infra:latest

# Push to registry
docker push exampleregistry.azurecr.io/self-service-infra:v2
docker push exampleregistry.azurecr.io/self-service-infra:latest

# Verify push
docker images | grep self-service-infra
```

---

### Step 5: Deploy to AKS (10 minutes)

#### Deploy Application

```bash
# Set kubectl context
kubectl config use-context <your-aks-context>

# Apply Kubernetes manifests
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl apply -f kubernetes/ingress.yaml

# Verify resources created
kubectl get all -n self-service-test
```

#### Monitor Deployment

```bash
# Watch pod startup
kubectl get pods -n self-service-test -w

# Check deployment status
kubectl rollout status deployment/self-service-infra -n self-service-test

# View logs
kubectl logs -f deployment/self-service-infra -n self-service-test

# Expected output:
# Server running on port 3000
# USE_VUE=true
# Frontend: Serving Vue.js SPA from dist/
```

---

### Step 6: Verify Production Deployment (10 minutes)

#### Health Checks

```bash
# Test health endpoint
curl https://self-service.example.com/health
# Expected: {"status":"ok","timestamp":"..."}

# Test home page
curl -I https://self-service.example.com
# Expected: HTTP/1.1 200 OK

# Test API endpoints
curl https://self-service.example.com/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

#### Manual QA Checklist

1. **Home Page**
   - [ ] Page loads without errors
   - [ ] 4 action cards visible
   - [ ] Dark mode toggle works
   - [ ] Navigation to other pages works

2. **Custom Infrastructure Page**
   - [ ] Form loads with all fields
   - [ ] Module selector shows categories
   - [ ] Submit triggers workflow
   - [ ] Status modal shows progress

3. **Template Deploy Page**
   - [ ] Templates load from API
   - [ ] Form validation works
   - [ ] Submit triggers workflow
   - [ ] Status modal shows progress

4. **Installed Apps Page**
   - [ ] Apps list loads from API
   - [ ] Search filters work
   - [ ] Environment filter works
   - [ ] Action buttons work (View in Azure, Delete, etc.)

5. **AKS Deploy Page**
   - [ ] Form loads with fields
   - [ ] Namespace auto-populates
   - [ ] Submit triggers workflow
   - [ ] Status modal shows progress

6. **Cross-Cutting Concerns**
   - [ ] Dark mode works on all pages
   - [ ] Navigation works between pages
   - [ ] No console errors in browser
   - [ ] SSL certificate valid
   - [ ] All API calls use HTTPS

---

## Configuration

### Environment Variables

**Frontend (Vite)**:
- `VITE_API_BASE_URL` - Backend API base URL

**Backend (Node.js)**:
- `NODE_ENV` - Set to `production`
- `USE_VUE` - Set to `true` to serve Vue.js app
- `PORT` - Server port (default: 3000)
- GitHub App credentials
- Azure subscription IDs
- Repository names

### Kubernetes Resources

**Deployment**:
- Replicas: 2 (for high availability)
- Image pull policy: Always
- Resource requests: 512Mi memory, 250m CPU
- Resource limits: 1Gi memory, 500m CPU
- Liveness probe: /health every 30s
- Readiness probe: /health every 10s

**Service**:
- Type: ClusterIP
- Port: 80 → 3000

**Ingress**:
- Host: self-service.example.com
- TLS: Enabled with cert-manager
- Class: nginx

---

## Monitoring & Health Checks

### Health Endpoint

```bash
# Application health
curl https://self-service.example.com/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-01-30T05:15:00.000Z"
}
```

### Kubernetes Monitoring

```bash
# Check pod status
kubectl get pods -n self-service-test

# Check pod logs
kubectl logs -f deployment/self-service-infra -n self-service-test

# Check pod events
kubectl describe pod <pod-name> -n self-service-test

# Check resource usage
kubectl top pods -n self-service-test
```

### Application Logs

```bash
# View real-time logs
kubectl logs -f deployment/self-service-infra -n self-service-test

# View logs from specific pod
kubectl logs <pod-name> -n self-service-test

# View logs with timestamps
kubectl logs --timestamps deployment/self-service-infra -n self-service-test

# Search logs
kubectl logs deployment/self-service-infra -n self-service-test | grep ERROR
```

---

## Rollback Procedures

### Option 1: Kubectl Rollback (Fastest - 2 minutes)

```bash
# View deployment history
kubectl rollout history deployment/self-service-infra -n self-service-test

# Rollback to previous version
kubectl rollout undo deployment/self-service-infra -n self-service-test

# Rollback to specific revision
kubectl rollout undo deployment/self-service-infra \
  --to-revision=2 \
  -n self-service-test

# Monitor rollback
kubectl rollout status deployment/self-service-infra -n self-service-test
```

### Option 2: Redeploy Previous Image (5 minutes)

```bash
# Update image to previous version
kubectl set image deployment/self-service-infra \
  self-service-infra=exampleregistry.azurecr.io/self-service-infra:v1 \
  -n self-service-test

# Verify rollback
kubectl get pods -n self-service-test
kubectl logs -f deployment/self-service-infra -n self-service-test
```

### Option 3: Restore from Git (10 minutes)

```bash
# Revert Git commit
git revert <commit-hash>
git push origin main

# CI/CD will automatically deploy previous version
# Monitor in GitHub Actions
```

---

## Troubleshooting

### Issue: Pods not starting

**Symptoms**:
- Pods stuck in `Pending` or `CrashLoopBackOff`
- Error logs show startup failures

**Diagnosis**:
```bash
kubectl describe pod <pod-name> -n self-service-test
kubectl logs <pod-name> -n self-service-test
```

**Common Causes & Solutions**:

1. **Image pull error**:
   ```bash
   # Verify ACR secret exists
   kubectl get secret acr-secret -n self-service-test
   
   # Recreate if needed
   kubectl create secret docker-registry acr-secret \
     --docker-server=exampleregistry.azurecr.io \
     --docker-username=<username> \
     --docker-password=<password> \
     -n self-service-test
   ```

2. **Missing secrets**:
   ```bash
   # List secrets
   kubectl get secrets -n self-service-test
   
   # Create missing secrets (see Step 1)
   ```

3. **Resource limits**:
   ```bash
   # Check node resources
   kubectl top nodes
   
   # Adjust deployment.yaml resource limits if needed
   ```

### Issue: Application not accessible

**Symptoms**:
- Health endpoint returns 404 or connection refused
- Ingress not routing traffic

**Diagnosis**:
```bash
# Check service
kubectl get svc self-service-infra -n self-service-test

# Check ingress
kubectl get ingress -n self-service-test
kubectl describe ingress self-service-infra-ingress -n self-service-test

# Test from inside cluster
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://self-service-infra.self-service-test.svc.cluster.local/health
```

**Common Causes & Solutions**:

1. **Service port mismatch**:
   ```yaml
   # Verify service.yaml ports:
   ports:
   - port: 80
     targetPort: 3000  # Must match container port
   ```

2. **Ingress not ready**:
   ```bash
   # Check ingress controller
   kubectl get pods -n ingress-nginx
   
   # Check ingress events
   kubectl describe ingress self-service-infra-ingress -n self-service-test
   ```

3. **DNS not resolving**:
   ```bash
   # Verify DNS record
   nslookup self-service.example.com
   
   # Update DNS if needed
   ```

### Issue: Vue.js app not loading

**Symptoms**:
- Blank page
- Console error: "Failed to load module"
- API calls to `/api/*` return 404

**Diagnosis**:
```bash
# Check if USE_VUE is set
kubectl logs deployment/self-service-infra -n self-service-test | grep USE_VUE

# Check if dist/ folder exists in container
kubectl exec -it <pod-name> -n self-service-test -- ls -la /app/dist
```

**Solutions**:

1. **USE_VUE not set**:
   ```yaml
   # Update deployment.yaml:
   env:
   - name: USE_VUE
     value: "true"
   ```

2. **Build artifacts missing**:
   ```bash
   # Rebuild Docker image
   npm run build:client
   docker build -t exampleregistry.azurecr.io/self-service-infra:v2 .
   docker push exampleregistry.azurecr.io/self-service-infra:v2
   
   # Redeploy
   kubectl rollout restart deployment/self-service-infra -n self-service-test
   ```

### Issue: API calls failing

**Symptoms**:
- Console errors: "Network error" or "401 Unauthorized"
- API endpoints return errors

**Diagnosis**:
```bash
# Check backend logs
kubectl logs deployment/self-service-infra -n self-service-test | grep ERROR

# Test API endpoints
curl https://self-service.example.com/api/installed-apps
```

**Common Causes & Solutions**:

1. **GitHub App credentials missing**:
   ```bash
   # Verify secrets exist
   kubectl get secrets -n self-service-test | grep github
   
   # Recreate secrets (see Step 1)
   ```

2. **CORS issues**:
   ```bash
   # Check server.js CORS configuration
   # Ensure VITE_API_BASE_URL matches actual domain
   ```

3. **GitHub API rate limits**:
   ```bash
   # Check GitHub API rate limit
   curl -H "Authorization: token <your-token>" \
     https://api.github.com/rate_limit
   ```

---

## Post-Deployment Checklist

- [ ] All pods running (2/2)
- [ ] Health endpoint responding
- [ ] Home page loads
- [ ] All 5 pages accessible
- [ ] Dark mode works
- [ ] API calls succeed
- [ ] Workflow polling works
- [ ] SSL certificate valid
- [ ] No console errors
- [ ] Monitoring alerts configured
- [ ] Backup procedure documented
- [ ] Rollback procedure tested

---

## Support & Contact

**Documentation**: `/docs/` folder in repository  
**GitHub**: https://github.com/<org>/self-service-infra  
**Slack**: #self-service-catalog  

---

**Version**: 2.0  
**Last Updated**: January 2026  
**Next Review**: After first production deployment
