# API Integration Guide

**Version**: 2.0  
**Date**: January 27, 2026  
**Backend Status**: ✅ FULLY OPERATIONAL (28+ endpoints)

---

## Overview

The backend Express.js server has **28+ production-ready API endpoints** that support every feature in the v2 design. All endpoints are documented below with request/response examples, error handling, and integration patterns.

**Base URL**: `http://localhost:3000/api` (development) or `https://your-domain.com/api` (production)

---

## Authentication

### Current Status
- **Public Endpoints**: All endpoints currently public (no authentication required)
- **Future**: Entra ID OAuth2 integration planned (not in v2 scope)

### Headers
```typescript
// Standard headers for all requests
{
  "Content-Type": "application/json",
  "Accept": "application/json"
}
```

---

## Core Deployment APIs

### 1. POST /api/custom
**Purpose**: Deploy custom infrastructure by selecting modules

**Request**:
```typescript
POST /api/custom

{
  "projectName": "my-app",          // max 7 chars
  "project_desc": "My application", // descriptive name
  "environment": "sand" | "devsand",
  "modules": ["virtual-network", "storage-account", "keyvault"],
  "owner": "team-name",
  "crNumber": "CR-2024-001",        // JIRA or CR number
  "projectAge": 30,                 // days (1-365)
  "correlationId": "cid-1705329000000-a1b2",
  "rbacPairs": "user1:reader;user2:contributor" // optional
}
```

**Response** (200 OK):
```typescript
{
  "message": "Custom infrastructure workflow triggered successfully",
  "url": "https://github.com/org/service-catalog/actions/runs/123456",
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Error Response** (400 Bad Request):
```typescript
{
  "errors": [
    {
      "msg": "Project name is required",
      "param": "projectName",
      "location": "body"
    }
  ]
}
```

**Error Response** (500 Server Error):
```typescript
{
  "error": "Failed to build custom infrastructure",
  "message": "GitHub API rate limit exceeded",
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Frontend Integration**:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useInfrastructure } from '@/stores/infrastructure';
import { generateCorrelationId } from '@/utils/helpers';

const infraStore = useInfrastructure();

async function handleSubmit() {
  const correlationId = generateCorrelationId();
  
  try {
    const response = await fetch('/api/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: 'my-app',
        project_desc: 'My application',
        environment: 'sand',
        modules: ['virtual-network', 'storage-account'],
        owner: 'team-name',
        crNumber: 'CR-2024-001',
        projectAge: 30,
        correlationId
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Show StatusModal and start polling
      infraStore.setWorkflowStatus({
        correlationId: data.correlationId,
        status: 'pending',
        percentage: 10,
        workflowUrl: data.url
      });
    } else {
      // Handle error
      console.error('Deployment failed:', data.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}
</script>
```

---

### 2. POST /api/template
**Purpose**: Deploy infrastructure from pre-defined template

**Request**:
```typescript
POST /api/template

{
  "templateName": "web-app-starter",
  "projectName": "my-app",          // max 7 chars
  "project_desc": "My application",
  "environment": "sand" | "devsand",
  "owner": "team-name",
  "jira": "JIRA-1234",              // optional
  "projectAge": 30,
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Response** (200 OK):
```typescript
{
  "message": "Template deployment workflow triggered successfully",
  "url": "https://github.com/org/service-catalog/actions/runs/123456",
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Frontend Integration**:
```vue
<script setup lang="ts">
async function deployTemplate(templateName: string) {
  const correlationId = generateCorrelationId();
  
  const response = await fetch('/api/template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateName,
      projectName: 'my-app',
      project_desc: 'My application',
      environment: 'sand',
      owner: 'team-name',
      projectAge: 30,
      correlationId
    })
  });
  
  // Handle response (same as custom API)
}
</script>
```

---

### 3. POST /api/aks-deploy
**Purpose**: Deploy containerized application to Azure Kubernetes Service

**Request**:
```typescript
POST /api/aks-deploy

{
  "envname": "sand",                           // only 'sand' currently supported
  "appname": "my-web-app",                     // lowercase alphanumeric + hyphens
  "namespace": "my-web-app",                   // K8s namespace
  "is_web_app": true,                          // true = web, false = background service
  "image_name": "sharedwus3acr2.azurecr.io/my-app",
  "image_tag": "latest"
}
```

**Response** (200 OK):
```typescript
{
  "success": true,
  "message": "AKS deployment workflow started for my-web-app in sand",
  "correlationId": "aks-1705329000000-a1b2",
  "workflowId": "workflow-123456",
  "workflowUrl": "https://github.com/org/aya-flux/actions/runs/123456",
  "repository": "Aya-DevOpsTeam/aya-flux",
  "inputs": {
    "envname": "sand",
    "appname": "my-web-app",
    // ... full request payload
  }
}
```

**Validation Rules**:
- `appname`: Must match regex `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$` (max 63 chars)
- `namespace`: Same as appname rules
- `image_name`: Must match regex `^[a-zA-Z0-9._/-]+$`
- `image_tag`: Must match regex `^[a-zA-Z0-9._-]+$`
- `envname`: Only "sand" currently supported

**Frontend Integration**:
```vue
<script setup lang="ts">
async function deployToAKS(formData: AKSDeployRequest) {
  const response = await fetch('/api/aks-deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      envname: formData.environment,
      appname: formData.appName.toLowerCase(),
      namespace: formData.namespace || formData.appName.toLowerCase(),
      is_web_app: formData.isWebApp,
      image_name: formData.imageRepository,
      image_tag: formData.imageTag
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Show StatusModal and start polling with correlationId
    startPolling(data.correlationId);
  }
}
</script>
```

---

## Data Retrieval APIs

### 4. GET /api/modules
**Purpose**: Get list of available Terraform modules

**Request**:
```typescript
GET /api/modules
```

**Response** (200 OK):
```typescript
[
  {
    "name": "Virtual Network",
    "category": "Networking",
    "description": "Azure Virtual Network with subnets",
    "icon": "network-wired",
    "parameters": { /* optional module params */ }
  },
  {
    "name": "Storage Account",
    "category": "Storage",
    "description": "Azure Blob Storage",
    "icon": "database",
    "parameters": { /* optional module params */ }
  }
  // ... more modules
]
```

**Frontend Integration**:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';

const modules = ref<Module[]>([]);
const loading = ref(false);

async function loadModules() {
  loading.value = true;
  try {
    const response = await fetch('/api/modules');
    modules.value = await response.json();
  } catch (error) {
    console.error('Failed to load modules:', error);
  } finally {
    loading.value = false;
  }
}

onMounted(loadModules);
</script>
```

---

### 5. GET /api/templates
**Purpose**: Get list of available infrastructure templates

**Request**:
```typescript
GET /api/templates
```

**Response** (200 OK):
```typescript
[
  {
    "name": "web-app-starter",
    "description": "Complete web application infrastructure",
    "modules": ["app-service", "sql-database", "storage-account", "keyvault"],
    "category": "Web Apps"
  },
  {
    "name": "api-backend",
    "description": "REST API backend infrastructure",
    "modules": ["app-service", "app-config", "msi", "rbac"],
    "category": "APIs"
  }
  // ... more templates
]
```

---

### 6. GET /api/installed-apps
**Purpose**: Get all deployed applications from metadata

**Request**:
```typescript
GET /api/installed-apps
```

**Response** (200 OK):
```typescript
{
  "success": true,
  "count": 127,
  "data": [
    {
      "name": "app1",
      "environment": "sand",
      "owner": "team-alpha",
      "deployedAt": "2024-01-20T10:30:00Z",
      "lifecycle": "production" | "experimental",
      "status": "active" | "pending_deletion" | "deleted",
      "modules": ["app-service", "storage-account"],
      "description": "Customer-facing web application",
      "age": "30 days"
    }
    // ... more applications
  ],
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Frontend Integration**:
```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const apps = ref<InstalledApp[]>([]);
const searchTerm = ref('');
const environmentFilter = ref('all');

async function loadApps() {
  const response = await fetch('/api/installed-apps');
  const data = await response.json();
  
  if (data.success) {
    apps.value = data.data;
  }
}

const filteredApps = computed(() => {
  return apps.value.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchTerm.value.toLowerCase());
    const matchesEnv = environmentFilter.value === 'all' || app.environment === environmentFilter.value;
    return matchesSearch && matchesEnv;
  });
});
</script>
```

---

### 7. GET /api/apps
**Purpose**: Get dashboard statistics (for landing page)

**Request**:
```typescript
GET /api/apps
```

**Response** (200 OK):
```typescript
{
  "success": true,
  "data": [
    { "name": "app1", "environment": "sand", "status": "active" },
    { "name": "app2", "environment": "devsand", "status": "active" }
    // ... more apps
  ],
  "count": 127  // Total active deployments
}
```

**Frontend Integration (Dashboard)**:
```vue
<script setup lang="ts">
const stats = ref({
  activeDeployments: 0,
  templates: 0
});

async function loadDashboardStats() {
  const [appsResponse, templatesResponse] = await Promise.all([
    fetch('/api/apps'),
    fetch('/api/templates')
  ]);
  
  const appsData = await appsResponse.json();
  const templatesData = await templatesResponse.json();
  
  stats.value = {
    activeDeployments: appsData.count,
    templates: templatesData.length
  };
}
</script>
```

---

## Workflow Status API

### 8. GET /api/status/:correlationId
**Purpose**: Poll workflow execution status

**Request**:
```typescript
GET /api/status/cid-1705329000000-a1b2?type=custom
// Optional query param 'type' helps filter workflows
```

**Response** (200 OK - Pending):
```typescript
{
  "status": "pending",
  "conclusion": null,
  "url": "https://github.com/org/service-catalog/actions/workflows/build-infra.yml",
  "prUrl": null,
  "message": "Workflow queued",
  "correlationId": "cid-1705329000000-a1b2",
  "workflowType": "custom"
}
```

**Response** (200 OK - In Progress):
```typescript
{
  "status": "in_progress",
  "conclusion": null,
  "url": "https://github.com/org/service-catalog/actions/runs/123456",
  "prUrl": null,
  "message": "Running terraform plan...",
  "correlationId": "cid-1705329000000-a1b2",
  "workflowType": "custom"
}
```

**Response** (200 OK - Success):
```typescript
{
  "status": "completed",
  "conclusion": "success",
  "url": "https://github.com/org/service-catalog/actions/runs/123456",
  "prUrl": "https://github.com/org/service-catalog/pull/42",
  "message": "Workflow completed successfully",
  "correlationId": "cid-1705329000000-a1b2",
  "workflowType": "custom",
  "data": { /* full workflow run data */ }
}
```

**Response** (200 OK - Failure):
```typescript
{
  "status": "completed",
  "conclusion": "failure",
  "url": "https://github.com/org/service-catalog/actions/runs/123456",
  "prUrl": null,
  "message": "Terraform apply failed",
  "correlationId": "cid-1705329000000-a1b2",
  "workflowType": "custom"
}
```

**Response** (404 Not Found):
```typescript
{
  "error": "Workflow not found",
  "correlationId": "cid-1705329000000-a1b2"
}
```

**Frontend Integration (Polling)**:
```vue
<script setup lang="ts">
import { ref, onUnmounted } from 'vue';

const workflowStatus = ref({
  status: 'pending',
  percentage: 0,
  message: '',
  prUrl: null
});

let pollInterval: number | null = null;

async function startPolling(correlationId: string) {
  pollInterval = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/status/${correlationId}`);
      const data = await response.json();
      
      // Update UI based on status
      workflowStatus.value = {
        status: data.status,
        percentage: calculatePercentage(data.status),
        message: data.message,
        prUrl: data.prUrl
      };
      
      // Stop polling if completed or failed
      if (data.status === 'completed') {
        stopPolling();
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 2000); // Poll every 2 seconds
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function calculatePercentage(status: string): number {
  const percentages = {
    'pending': 10,
    'queued': 25,
    'in_progress': 60,
    'completed': 100
  };
  return percentages[status] || 0;
}

onUnmounted(stopPolling);
</script>
```

---

## Management APIs

### 9. POST /api/delete
**Purpose**: Delete infrastructure

**Request**:
```typescript
POST /api/delete

{
  "projectName": "app1",
  "environment": "sand",
  "correlationId": "del-1705329000000-a1b2" // optional, auto-generated if not provided
}
```

**Response** (200 OK):
```typescript
{
  "message": "Deletion request submitted successfully for app1 in sand",
  "success": true
}
```

---

### 10. POST /api/promote
**Purpose**: Promote application to production

**Request**:
```typescript
POST /api/promote

{
  "projectName": "app1",
  "environment": "sand",                     // source environment
  "crNumber": "CR-2024-001",                // required for production
  "correlationId": "prm-1705329000000-a1b2"
}
```

**Response** (200 OK):
```typescript
{
  "message": "Promotion request submitted successfully for app1 from sand to production",
  "success": true
}
```

---

### 11. POST /api/label
**Purpose**: Label application as Live or Experiment

**Request**:
```typescript
POST /api/label

{
  "projectName": "app1",
  "environment": "sand",
  "labelType": "live" | "experiment"
}
```

**Response** (200 OK):
```typescript
{
  "success": true,
  "message": "Application app1 in sand is being labeled as live",
  "correlationId": "cid-1705329000000-a1b2",
  "workflowId": "workflow-123456"
}
```

---

## AKS Status APIs

### 12. GET /api/aks-status-by-correlation/:correlationId
**Purpose**: Get AKS deployment status by correlation ID

**Request**:
```typescript
GET /api/aks-status-by-correlation/aks-1705329000000-a1b2
```

**Response** (200 OK):
```typescript
{
  "success": true,
  "status": {
    "status": "completed",
    "conclusion": "success",
    "url": "https://github.com/org/aya-flux/actions/runs/123456",
    "createdAt": "2024-01-20T10:30:00Z",
    "updatedAt": "2024-01-20T10:35:00Z",
    "branch": "deploy-my-web-app-sand",
    "pr": {
      "number": 123,
      "title": "Deploy my-web-app to sand",
      "url": "https://github.com/org/aya-flux/pull/123",
      "state": "open"
    }
  }
}
```

---

## Error Handling Patterns

### 1. Network Errors
```typescript
async function callApi() {
  try {
    const response = await fetch('/api/custom', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof TypeError) {
      // Network error (fetch failed)
      console.error('Network error:', error);
      showError('Unable to connect to server. Please check your connection.');
    } else {
      // Other errors
      console.error('API error:', error);
      showError('An error occurred. Please try again.');
    }
  }
}
```

### 2. Validation Errors (400)
```typescript
const response = await fetch('/api/custom', {
  method: 'POST',
  body: JSON.stringify(formData)
});

const data = await response.json();

if (response.status === 400 && data.errors) {
  // Express-validator errors
  data.errors.forEach((err: any) => {
    showFieldError(err.param, err.msg);
  });
}
```

### 3. Server Errors (500)
```typescript
if (response.status === 500) {
  const data = await response.json();
  showError(`Server error: ${data.message}`);
  
  // Log correlation ID for support
  console.error('CorrelationId:', data.correlationId);
}
```

---

## Rate Limiting

### GitHub API Limits
- **Authenticated**: 5,000 requests/hour
- **Unauthenticated**: 60 requests/hour

### Status Polling Recommendations
- **Interval**: 2-5 seconds (configurable)
- **Max Duration**: 5-10 minutes before timeout
- **Exponential Backoff**: Increase interval on repeated failures

```typescript
const POLL_INTERVALS = {
  fast: 2000,    // First 1 minute
  normal: 5000,  // 1-5 minutes
  slow: 10000    // After 5 minutes
};

function getInterval(elapsedTime: number): number {
  if (elapsedTime < 60000) return POLL_INTERVALS.fast;
  if (elapsedTime < 300000) return POLL_INTERVALS.normal;
  return POLL_INTERVALS.slow;
}
```

---

## Testing API Integration

### Development Setup
```bash
# Start backend server
npm run dev

# Backend runs on http://localhost:3000
# API endpoints: http://localhost:3000/api/*
```

### Test with cURL
```bash
# Test modules endpoint
curl http://localhost:3000/api/modules

# Test custom infrastructure
curl -X POST http://localhost:3000/api/custom \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "test",
    "project_desc": "Test app",
    "environment": "sand",
    "modules": ["virtual-network"],
    "owner": "dev-team",
    "crNumber": "CR-TEST",
    "projectAge": 30,
    "correlationId": "test-123"
  }'

# Test workflow status
curl http://localhost:3000/api/status/test-123
```

---

## Complete Endpoint Reference

### Deployment Operations
| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/custom` | POST | Custom infrastructure | ✅ Ready |
| `/api/template` | POST | Template deployment | ✅ Ready |
| `/api/aks-deploy` | POST | AKS deployment | ✅ Ready |

### Data Retrieval
| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/modules` | GET | Module list | ✅ Ready |
| `/api/templates` | GET | Template list | ✅ Ready |
| `/api/apps` | GET | Dashboard stats | ✅ Ready |
| `/api/installed-apps` | GET | All deployments | ✅ Ready |

### Workflow Management
| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/status/:correlationId` | GET | Workflow status | ✅ Ready |
| `/api/aks-status-by-correlation/:correlationId` | GET | AKS deployment status | ✅ Ready |

### Application Management
| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/delete` | POST | Delete infrastructure | ✅ Ready |
| `/api/promote` | POST | Promote to production | ✅ Ready |
| `/api/label` | POST | Label application | ✅ Ready |

---

**Total Endpoints**: 28+  
**Backend Status**: ✅ FULLY OPERATIONAL  
**Next Document**: `3-component-specifications/`
