# MVP Scope - v2 Design System

**Version**: 2.0  
**Date**: January 27, 2026  
**Status**: ALL FEATURES BACKEND-READY ✅

---

## Executive Summary

**NO STRETCH GOALS** - Every feature in the v2 design has backend API support.

| Feature Category | Features | Backend APIs | Status |
|------------------|----------|--------------|--------|
| **Shared Components** | Header, StatusModal | N/A | 🔴 CREATE |
| **Core Deployments** | Custom, Template, AKS | ✅ 3 POST endpoints | 🟡 UPDATE |
| **Management** | View/Delete/Promote | ✅ 5 GET/POST endpoints | 🟡 UPDATE |
| **Dashboard** | Stats, Charts, Activity | ✅ 2 GET endpoints | 🟢 READY |

---

## Feature Inventory

### 1. Shared Components (CRITICAL PATH)

#### SharedHeader.vue 🔴 NEW
**Priority**: CRITICAL  
**Estimated Time**: 4-6 hours  
**Backend API**: None required  

**Features**:
- Product branding ("Self Service Catalog" + logo)
- Main navigation (Home, Custom, Template, Apps, AKS)
- Dark mode toggle
- User avatar/profile dropdown (future Entra ID)
- Responsive mobile menu

**Design Assets**:
- All 11 HTML files show the header
- Consistent across all screens

**Implementation Notes**:
- Use Vue Router for navigation (existing setup in `srcV2/`)
- Dark mode state in Pinia store (existing pattern)
- Mobile breakpoint: 768px (Tailwind md: breakpoint)

---

#### StatusModal.vue 🔴 NEW
**Priority**: CRITICAL  
**Estimated Time**: 3-4 hours  
**Backend API**: GET /api/status/:correlationId

**Features**:
- 3 visual states: Pending, In Progress, Success/Failure
- Real-time workflow progress tracking
- Correlation ID display
- Pull request link display
- Auto-polling (updates every 2s)
- Manual close button

**Design Assets**:
- `status-modal-pending.html` - Initial state
- `status-modal-in-progress.html` - Running state
- `status-modal-success.html` - Completion state

**Backend Integration**:
```typescript
// Poll workflow status
GET /api/status/:correlationId

Response:
{
  "status": "pending" | "in_progress" | "success" | "failure",
  "percentage": 0-100,
  "message": "Workflow description",
  "prUrl": "https://github.com/org/repo/pull/123",
  "workflowUrl": "https://github.com/org/repo/actions/runs/456"
}
```

**Implementation Notes**:
- Use existing `useWorkflowPolling` composable
- Integrate with existing `workflow` Pinia store
- Add to `srcV2/components/modals/` directory

---

### 2. Home Page / Dashboard 🟢 MINIMAL CHANGES

**Priority**: MEDIUM  
**Estimated Time**: 2-3 hours  
**Backend API**: GET /api/apps (existing)

**Features**:
- Dashboard statistics (Active Deployments, Templates Available)
- 4 action cards (Custom, Template, Apps, AKS)
- "Getting Started" CTA section
- Activity feed preview

**Design Assets**:
- `home-page.html` - Light mode
- `home-page-dark.html` - Dark mode

**Backend Integration**:
```typescript
GET /api/apps

Response:
{
  "success": true,
  "data": [
    { "name": "app1", "environment": "sand", "status": "active" },
    // ... more apps
  ],
  "count": 127
}
```

**Implementation Notes**:
- Existing `HomePage.vue` in `srcV2/views/`
- Update styling to match v2 design
- Add dashboard stats using real API data
- Keep existing navigation handlers

---

### 3. Custom Infrastructure Page 🟡 UPDATE

**Priority**: HIGH  
**Estimated Time**: 2-3 hours  
**Backend API**: 
- GET /api/modules (existing)
- POST /api/custom (existing)

**Features**:
- Project name + description input
- Environment selector (sand, devsand)
- Module grid with categories
- Multi-select module picker
- Owner + CR/JIRA + Age inputs
- "Generate Code" CTA button
- StatusModal integration on submit

**Design Assets**:
- `custom-infrastructure-page.html`
- `custom-infrastructure-page-dark.html`

**Backend Integration**:
```typescript
// Get available modules
GET /api/modules

Response:
{
  "success": true,
  "data": [
    {
      "name": "Virtual Network",
      "category": "Networking",
      "description": "Azure Virtual Network...",
      "icon": "network-wired"
    },
    // ... more modules
  ]
}

// Submit custom infrastructure request
POST /api/custom

Request:
{
  "projectName": "my-app",
  "project_desc": "My application",
  "environment": "sand",
  "modules": ["virtual-network", "storage-account"],
  "owner": "team-name",
  "crNumber": "CR-2024-001",
  "projectAge": 30,
  "correlationId": "cid-1234567890-abcd"
}

Response:
{
  "message": "Workflow triggered successfully",
  "correlationId": "cid-1234567890-abcd",
  "url": "https://github.com/.../actions/runs/..."
}
```

**Implementation Notes**:
- Existing `CustomInfrastructurePage.vue` in `srcV2/views/`
- Update form layout to match v2 design
- Integrate StatusModal on form submit
- Use existing `infrastructure` Pinia store

---

### 4. Template Deploy Page 🟡 UPDATE

**Priority**: HIGH  
**Estimated Time**: 2-3 hours  
**Backend API**:
- GET /api/templates (existing)
- POST /api/template (existing)

**Features**:
- Template selection dropdown
- Template preview card
- Project name + description input
- Environment selector
- Owner + JIRA/CR + Age inputs
- "Deploy Template" CTA button
- StatusModal integration on submit

**Design Assets**:
- `template-deploy-page.html`
- `template-deploy-page-dark.html`

**Backend Integration**:
```typescript
// Get available templates
GET /api/templates

Response:
{
  "success": true,
  "data": [
    {
      "name": "Web Application Starter",
      "description": "Complete web app infrastructure",
      "modules": ["app-service", "sql-database", "storage"],
      "category": "Web Apps"
    },
    // ... more templates
  ]
}

// Submit template deployment request
POST /api/template

Request:
{
  "templateName": "web-app-starter",
  "projectName": "my-app",
  "project_desc": "My application",
  "environment": "sand",
  "owner": "team-name",
  "jira": "JIRA-1234",
  "projectAge": 30,
  "correlationId": "cid-1234567890-abcd"
}

Response:
{
  "message": "Template deployment triggered",
  "correlationId": "cid-1234567890-abcd",
  "url": "https://github.com/.../actions/runs/..."
}
```

**Implementation Notes**:
- Existing `TemplateDeployPage.vue` in `srcV2/views/`
- Update form layout to match v2 design
- Add template preview card
- Integrate StatusModal on form submit

---

### 5. Installed Apps Page 🟡 UPDATE

**Priority**: HIGH  
**Estimated Time**: 3-4 hours  
**Backend API**:
- GET /api/installed-apps (existing)
- POST /api/delete (existing)
- POST /api/promote (existing)
- POST /api/label (existing)

**Features**:
- Applications data table with columns:
  - Project Name / Environment
  - Status badge (Active, Pending Deletion)
  - Owner
  - Created Date
  - Actions menu (View, Delete, Promote, Label)
- Search + filter controls
- Environment filter dropdown
- StatusModal integration for delete/promote operations

**Design Assets**:
- `installed-apps-page.html`
- `installed-apps-page-dark.html`

**Backend Integration**:
```typescript
// Get all installed applications
GET /api/installed-apps

Response:
{
  "success": true,
  "count": 127,
  "data": [
    {
      "name": "app1",
      "environment": "sand",
      "owner": "team-alpha",
      "deployedAt": "2024-01-20T10:30:00Z",
      "lifecycle": "production",
      "status": "active",
      "modules": ["app-service", "storage-account"],
      "age": "30 days"
    },
    // ... more apps
  ]
}

// Delete infrastructure
POST /api/delete

Request:
{
  "projectName": "app1",
  "environment": "sand",
  "correlationId": "cid-1234567890-abcd"
}

Response:
{
  "success": true,
  "message": "Deletion request submitted"
}

// Promote to production
POST /api/promote

Request:
{
  "projectName": "app1",
  "environment": "sand",
  "crNumber": "CR-2024-001",
  "correlationId": "cid-1234567890-abcd"
}

Response:
{
  "success": true,
  "message": "Promotion request submitted"
}

// Label application
POST /api/label

Request:
{
  "projectName": "app1",
  "environment": "sand",
  "labelType": "live" | "experiment"
}

Response:
{
  "success": true,
  "message": "Label applied successfully"
}
```

**Implementation Notes**:
- Existing `InstalledAppsPage.vue` in `srcV2/views/`
- Update table layout to match v2 design
- Add actions dropdown menu
- Integrate StatusModal for delete/promote operations
- Use existing `infrastructure` Pinia store

---

### 6. AKS Deploy Page 🟡 UPDATE

**Priority**: HIGH  
**Estimated Time**: 2-3 hours  
**Backend API**: 
- POST /api/aks-deploy (existing)
- GET /api/aks-status-by-correlation/:correlationId (existing)

**Features**:
- Environment selector (sand, devsand)
- Application name input
- Namespace input (auto-populated from app name)
- Application type radio buttons (Web App, Background Service)
- Container image + tag inputs
- "Deploy to AKS" CTA button
- StatusModal integration on submit

**Design Assets**:
- `aks-deploy-page.html`
- `aks-deploy-page-dark.html`

**Backend Integration**:
```typescript
// Submit AKS deployment request
POST /api/aks-deploy

Request:
{
  "envname": "sand",
  "appname": "my-web-app",
  "namespace": "my-web-app",
  "is_web_app": true,
  "image_name": "sharedwus3acr2.azurecr.io/my-app",
  "image_tag": "latest"
}

Response:
{
  "success": true,
  "message": "AKS deployment workflow started",
  "correlationId": "aks-1234567890-abcd",
  "workflowUrl": "https://github.com/.../actions/runs/..."
}

// Get AKS deployment status
GET /api/aks-status-by-correlation/:correlationId

Response:
{
  "success": true,
  "status": {
    "status": "completed",
    "conclusion": "success",
    "url": "https://github.com/.../actions/runs/...",
    "pr": {
      "number": 123,
      "title": "Deploy my-web-app to sand",
      "url": "https://github.com/.../pull/123"
    }
  }
}
```

**Implementation Notes**:
- Existing `AKSDeployPage.vue` in `srcV2/views/`
- Update form layout to match v2 design
- Add radio button styling for app type
- Auto-populate namespace from app name
- Integrate StatusModal on form submit

---

## Priority Matrix

### Must Have (2.5 days) ⭐⭐⭐
1. **SharedHeader.vue** (4-6h) - Used by all pages
2. **StatusModal.vue** (3-4h) - Used by all deployment workflows
3. **CustomInfrastructurePage.vue v2** (2-3h) - Core feature
4. **TemplateDeployPage.vue v2** (2-3h) - Core feature
5. **InstalledAppsPage.vue v2** (3-4h) - Core management

**Total**: ~20 hours

### Should Have (+0.5 days) ⭐⭐
6. **AKSDeployPage.vue v2** (2-3h) - Secondary deployment method
7. **HomePage.vue v2** (2-3h) - Landing page polish

**Total**: ~5 hours

### Nice to Have (+0.5 days) ⭐
8. Dark mode testing across all components (2h)
9. Responsive testing (mobile, tablet) (2h)
10. Accessibility audit (1h)

**Total**: ~5 hours

---

## Implementation Order

### Phase 1: Foundation (Day 1 Morning)
```
├── SharedHeader.vue (4-6h)
└── StatusModal.vue (3-4h)
```

**Why First**: These are dependencies for all other pages.

---

### Phase 2: Core Deployments (Day 1 Afternoon + Day 2)
```
├── CustomInfrastructurePage.vue v2 (2-3h)
├── TemplateDeployPage.vue v2 (2-3h)
└── InstalledAppsPage.vue v2 (3-4h)
```

**Why Second**: Primary user workflows.

---

### Phase 3: Secondary Features (Day 3 Morning)
```
├── AKSDeployPage.vue v2 (2-3h)
└── HomePage.vue v2 (2-3h)
```

**Why Third**: Lower frequency use, but important for completeness.

---

### Phase 4: Polish (Day 3 Afternoon)
```
├── Dark mode testing (2h)
├── Responsive testing (2h)
└── Accessibility audit (1h)
```

**Why Last**: Quality assurance after all features implemented.

---

## Acceptance Criteria

### Functional Requirements ✅

| Feature | Criteria |
|---------|----------|
| **SharedHeader** | • Logo + product name visible<br>• Navigation links functional<br>• Dark mode toggle works<br>• Responsive mobile menu |
| **StatusModal** | • 3 states render correctly<br>• Auto-polling works<br>• PR links clickable<br>• Manual close works |
| **Custom Infra** | • Form submits successfully<br>• StatusModal appears<br>• Workflow tracking works<br>• Module selection works |
| **Template Deploy** | • Template selection works<br>• Form submits successfully<br>• StatusModal appears<br>• Workflow tracking works |
| **Installed Apps** | • Table loads data<br>• Search/filter works<br>• Actions menu functional<br>• Delete/Promote works |
| **AKS Deploy** | • Form submits successfully<br>• StatusModal appears<br>• Workflow tracking works<br>• Namespace auto-fill works |
| **Home Page** | • Dashboard stats load<br>• Action cards clickable<br>• Navigation works |

### Non-Functional Requirements ✅

| Category | Criteria |
|----------|----------|
| **Performance** | • Page load < 2s<br>• StatusModal polling < 1s response<br>• Table renders 100+ rows smoothly |
| **Accessibility** | • WCAG 2.1 AA compliant<br>• Keyboard navigation works<br>• Screen reader friendly |
| **Responsive** | • Mobile (< 768px) functional<br>• Tablet (768px-1024px) functional<br>• Desktop (> 1024px) optimal |
| **Dark Mode** | • All pages support dark mode<br>• Toggle persists preference<br>• Smooth transitions |
| **Branding** | • "Self Service Catalog" consistent<br>• Logo visible on all pages<br>• Color scheme consistent |

---

## Out of Scope (Future)

### Not in v2 Design
- ❌ Entra ID authentication (future)
- ❌ User profile/settings page (future)
- ❌ Multi-tenancy support (future)
- ❌ Advanced RBAC configuration (future)
- ❌ Infrastructure cost estimation (future)
- ❌ Resource tagging UI (future)

These features may be added in future iterations but are not part of the current v2 design handoff.

---

## Success Metrics

### Implementation Complete When:
- ✅ All 7 components built/updated
- ✅ All acceptance criteria met
- ✅ Dark mode works across all pages
- ✅ Responsive design verified on 3 breakpoints
- ✅ All backend APIs integrated successfully
- ✅ StatusModal workflow tracking operational
- ✅ No console errors or warnings
- ✅ Passes accessibility audit

### Expected Timeline:
- **Best Case**: 2.5 developer days
- **Realistic**: 3 developer days
- **With Buffer**: 4 developer days

---

**Document Version**: 1.0  
**Last Updated**: January 27, 2026  
**Next Document**: `2-api-integration-guide.md`
