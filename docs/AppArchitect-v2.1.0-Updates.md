# AppArchitect.json v2.1.0 Updates Summary

**Date**: 2026-01-22  
**Previous Version**: 2.0.0  
**Current Version**: 2.1.0  
**Purpose**: Document all srcV2 migration features and business rules in architecture specification

---

## Overview

This update ensures the Self-Service-Infra.AppArchitect.json architecture specification accurately reflects all features, patterns, and business rules implemented during the Vue 3 (srcV2) migration. The specification now captures critical audit trail functionality, RBAC enhancements, API standardization patterns, and workflow corrections that were not previously documented.

---

## Critical Updates

### 1. ✅ Audit Trail (triggered_by) Pattern

**Location**: `coreDomains.workflowOrchestration.capabilities[0].businessRules`

**What Changed**:
- Added `triggeredBy` to workflow inputs
- Documented that authenticated user email is captured from `req.user.email`
- Specified safe fallback pattern: `req.user?.email || owner || 'unknown'`
- Clarified triggeredBy is included in GitHub PR descriptions for compliance

**Business Impact**:
- All 6 workflow types now have full audit trail
- Compliance tracking for who initiated infrastructure changes
- Prevents workflow failures if authentication context missing

**Affected Workflows**:
1. Custom infrastructure provisioning
2. Template deployment
3. Infrastructure deletion
4. Production promotion
5. AKS deployment
6. Label/status changes

---

### 2. ✅ RBAC Role Enhancements

#### New Data Model: `rbacRole`

**Location**: `dataModels.rbacRole`

**What Changed**:
- Added complete RBAC role data model (previously missing)
- Documented 31+ roles across 10 scopes
- Added App Configuration roles (missing from previous spec):
  - `App Configuration Data Reader`
  - `App Configuration Data Owner`

**Implementation Details**:
```json
{
  "dataSource": {
    "location": "data/roles.json",
    "apiEndpoint": "GET /api/roles",
    "pattern": "Dynamic loading via API (not static file serving)",
    "totalRoles": "31+",
    "totalScopes": 10
  }
}
```

**New Scopes Added**:
- `appconfiguration` (App Configuration services)

**Business Rules Updated**:
- Roles loaded dynamically from external configuration
- Following module/template API pattern for consistency
- Enables external role management without code changes

---

### 3. ✅ API Response Standardization

**Location**: `interfaces.apiResponseFormat` (NEW SECTION)

**What Changed**:
- Documented standardized response contract for ALL API endpoints
- Specified fields: `success`, `data`, `error`, `correlationId`, `prNumber`
- Explained centralized API client pattern with automatic token refresh
- Documented 401 error handling with automatic Entra ID token refresh

**Schema**:
```json
{
  "success": "boolean (required)",
  "data": "any (when success=true)",
  "error": "string (when success=false)",
  "correlationId": "uuid (required)",
  "prNumber": "integer (optional, for workflow tracking)"
}
```

**Business Rules**:
- All endpoints must return this format
- Frontend uses centralized `api.ts` service
- Automatic retry on 401 unauthorized
- CorrelationId threaded through logs, PRs, status polling

---

### 4. ✅ Workflow Sequence Correction

**Location**: `dataFlows.provisionInfrastructure.steps[6]`

**What Changed**:
- Corrected workflow execution order
- **Previous (incorrect)**: Create PR → Run validations → Apply changes
- **Current (correct)**: Run validations → Apply changes → Create PR

**Substeps Now Reflect Reality**:
1. Generate infrastructure code from modules/template
2. Run validation checks
3. Apply infrastructure changes
4. Create metadata file
5. **Create pull request with code and metadata (after workflow execution)**

**Note Added**: "GitHub Actions workflow runs FIRST (60% progress), then creates PR (90% progress)"

**UI Components Updated**:
- `DeploymentPage.vue`
- `StatusModal.vue`

---

### 5. ✅ Entra ID Authentication Implementation

**Location**: `migrationConsiderations.authenticationMigration`

**Status**: Changed from "scenario" to **"IMPLEMENTED in srcV2"**

**What Changed**:
- Documented actual implementation (not just plan)
- Specified middleware: `middleware/auth.js` with JWT validation
- Explained `req.user.email` extraction pattern
- Listed public vs protected endpoints

**Implementation Details**:
```javascript
// Protected endpoints require authentication
requireAuth middleware validates JWT tokens

// Public endpoints (no auth required):
- GET /api/roles
- GET /api/modules
- GET /api/templates
- GET /api/agents
```

**Workflow Integration**:
- All workflows receive `triggeredBy` parameter
- GitHub Actions include triggeredBy in PR descriptions
- Covers all 6 workflow types

---

### 6. ✅ Vue 3 Frontend Migration Details

**Location**: `migrationConsiderations.frontendFrameworkMigration`

**Status**: Changed from "scenario" to **"IMPLEMENTED - Vue 3 with TypeScript in srcV2/"**

**What Changed**:
- Documented complete Vue 3 tech stack
- Listed all 7 page components
- Detailed component categories (infrastructure, modals, common)
- Documented composables for reusable logic
- Explained development modes (HMR vs production)

**Technology Stack Documented**:
- Framework: Vue 3 Composition API
- Language: TypeScript 5.x
- Build Tool: Vite 7.3.1
- State Management: Pinia stores
- Testing: Vitest with @vue/test-utils

**Key Composables**:
- `useApi` - Centralized API client with auto auth refresh
- `useAuth` - Authentication state management
- `useWorkflowPolling` - Status polling with cleanup
- `useNotification` - User notifications

**Development Modes**:
- Hot Reload: `npm run dev:client` (Vite :5173 → Express :3000)
- Production: `npm run build:client → USE_VUE=true npm start`

---

### 7. ✅ srcV2 Implementation Patterns (NEW SECTION)

**Location**: `migrationConsiderations.srcV2Implementation` (NEW)

**Purpose**: Capture key architectural patterns as implemented in Vue 3 codebase

**Key Patterns Documented**:

#### Audit Trail Pattern
```json
{
  "pattern": "Authenticated user email (triggeredBy) passed to all workflows",
  "implementation": "req.user?.email || owner || 'unknown'",
  "coverage": "All 6 workflow types",
  "visibility": "Included in GitHub PR descriptions"
}
```

#### Dynamic Configuration Pattern
```json
{
  "pattern": "External JSON configs loaded via API",
  "endpoints": [
    "GET /api/modules",
    "GET /api/templates",
    "GET /api/roles",
    "GET /api/agents"
  ],
  "rationale": "Enables external management without code changes"
}
```

#### API Standardization Pattern
```json
{
  "pattern": "{success, data, error, correlationId}",
  "clientImplementation": "Centralized api.ts with axios interceptors",
  "errorHandling": "401 triggers automatic token refresh"
}
```

#### Workflow Sequence Pattern
```json
{
  "pattern": "GitHub Actions → Pull Request (not PR → Actions)",
  "uiProgress": "60% Actions, 90% PR created, 100% complete",
  "components": ["DeploymentPage.vue", "StatusModal.vue"]
}
```

#### Type Safety Pattern
```json
{
  "pattern": "Full TypeScript coverage in srcV2",
  "types": "srcV2/types/infrastructure.types.ts",
  "validation": "npm run type-check"
}
```

---

### 8. ✅ Workflow Types Extended

**Location**: `dataModels.workflow.attributes.workflowType.values`

**What Changed**:
- Expanded from 4 to 6 workflow types
- Added missing workflow types

**Previous**:
```json
["provision", "delete", "promote", "deploy-aks"]
```

**Current**:
```json
[
  "provision-custom",
  "provision-template",
  "delete",
  "promote",
  "deploy-aks",
  "label-change"
]
```

---

### 9. ✅ Workflow Data Model Enhanced

**Location**: `dataModels.workflow.attributes`

**What Changed**:
- Added `triggeredBy` field (previously missing)
- Clarified `initiatedBy` captures from `req.user.email`

**New Fields**:
```json
{
  "initiatedBy": {
    "type": "string",
    "required": true,
    "description": "User or system that triggered workflow (captured from req.user.email)"
  },
  "triggeredBy": {
    "type": "string",
    "required": true,
    "description": "Authenticated user email passed to GitHub Actions for audit trail"
  }
}
```

---

## Files Modified

### Primary File
- [Self-Service-Infra.AppArchitect.json](../Self-Service-Infra.AppArchitect.json)
  - Version: 2.0.0 → **2.1.0**
  - Last Updated: 2026-01-20 → **2026-01-22**
  - Added ~180 new lines of documentation
  - 1088 → 1274 lines total

---

## Verification

### ✅ Validation Checks Performed
```bash
# JSON syntax validation
jq '.version, .lastUpdated' Self-Service-Infra.AppArchitect.json
# Output: "2.1.0" "2026-01-22"

# File structure integrity
jq 'keys' Self-Service-Infra.AppArchitect.json
# Output: All expected top-level keys present
```

### ✅ Coverage Analysis

Review confirmed these srcV2 features are now documented:

| Feature | Status | Location in AppArchitect.json |
|---------|--------|-------------------------------|
| Audit Trail (triggered_by) | ✅ Documented | `workflowOrchestration.capabilities[0].businessRules` |
| App Configuration Roles | ✅ Documented | `dataModels.rbacRole`, new scope added |
| Dynamic Role Loading API | ✅ Documented | `dataModels.rbacRole.dataSource`, business rules |
| API Response Format | ✅ Documented | `interfaces.apiResponseFormat` (new section) |
| Workflow Sequence Correction | ✅ Documented | `dataFlows.provisionInfrastructure.steps[6]` |
| Entra ID Implementation | ✅ Documented | `migrationConsiderations.authenticationMigration` |
| Vue 3 Tech Stack | ✅ Documented | `migrationConsiderations.frontendFrameworkMigration` |
| srcV2 Patterns Summary | ✅ Documented | `migrationConsiderations.srcV2Implementation` (new) |
| All 6 Workflow Types | ✅ Documented | `dataModels.workflow.attributes.workflowType.values` |

---

## Business Impact

### Compliance & Audit
- ✅ Full audit trail for infrastructure changes via triggered_by
- ✅ User identity tracked in all GitHub PR descriptions
- ✅ Compliance with governance requirements

### Developer Experience
- ✅ Clear specification of API response contracts
- ✅ Documented all Vue 3 components and composables
- ✅ Type safety patterns explained for TypeScript developers

### Operations & Maintenance
- ✅ External role management documented (add roles without code changes)
- ✅ Workflow sequence corrections prevent UI confusion
- ✅ Development modes clearly explained (HMR vs production)

### Architecture Alignment
- ✅ Specification matches actual implementation
- ✅ Future developers have accurate reference
- ✅ Onboarding documentation is trustworthy

---

## Next Steps

### Recommended Actions

1. **Review Architecture Diagrams** (if any exist)
   - Ensure Mermaid diagrams reflect corrected workflow sequence
   - Update sequence diagrams with triggeredBy parameter flow

2. **Update Developer Onboarding Docs**
   - Reference AppArchitect.json v2.1.0 in README
   - Link to this summary document for changelog

3. **ADR Consideration**
   - Consider creating ADR for "API Response Standardization Pattern"
   - Consider ADR for "External Configuration via API Pattern"

4. **Testing Documentation**
   - Ensure test cases cover all 6 workflow types with triggered_by
   - Document expected behavior of req.user?.email fallback

---

## References

### Related Documentation
- [Architecture.md](./Architecture.md) - Detailed system architecture
- [AUTHENTICATION-GUIDE.md](./AUTHENTICATION-GUIDE.md) - Entra ID setup
- [Vue-Architecture-Diagram.md](./Vue-Architecture-Diagram.md) - Vue dev modes
- [Migration-Guide-Vue.js.md](./Migration-Guide-Vue.js.md) - Vue migration details

### Code References
- [routes/api.js](../routes/api.js) - All API endpoints with triggered_by
- [services/infrastructureService.js](../services/infrastructureService.js) - Workflow triggering with triggeredBy
- [srcV2/services/api.ts](../srcV2/services/api.ts) - Centralized API client
- [data/roles.json](../data/roles.json) - RBAC role definitions
- [middleware/auth.js](../middleware/auth.js) - JWT validation

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-01-20 | Initial architecture-vs-technology separation |
| **2.1.0** | **2026-01-22** | **srcV2 implementation features documented** |

---

**Document Prepared By**: GitHub Copilot (SelfService App Architect Agent)  
**Review Status**: Ready for Human Review  
**Completeness**: ✅ All identified gaps addressed
