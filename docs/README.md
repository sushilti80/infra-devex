# SelfService Infrastructure Catalog - Architecture Documentation

**Version**: 2.0  
**Last Updated**: 2024-01-20  
**Status**: Production  

---

## 📚 Documentation Structure

This folder contains comprehensive architecture documentation for the SelfService Infrastructure Catalog system.

### Core Documents

| Document | Purpose | Audience | Size |
|----------|---------|----------|------|
| **[Architecture.md](./Architecture.md)** | Complete architecture specification with detailed diagrams, API docs, security, deployment | Architects, Developers, DevOps | 1,893 lines (52KB) |
| **[Architecture-Quick-Reference.md](./Architecture-Quick-Reference.md)** | Quick access guide with key patterns, API endpoints, checklists | All team members | 402 lines (16KB) |
| **[Architecture-Diagrams.md](./Architecture-Diagrams.md)** | Visual diagram index with all Mermaid diagrams | Visual learners, Presentations | ~500 lines (20KB) |
| **[Architecture-vs-Technology.md](./Architecture-vs-Technology.md)** | Explains separation between architecture (WHAT) and technology (HOW) | Architects, Tech Leads | ~15KB |

### Architecture Specification (Technology-Agnostic)

| Document | Purpose | Audience | Format |
|----------|---------|----------|--------|
| **[Self-Service-Infra.AppArchitect.json](../Self-Service-Infra.AppArchitect.json)** | Technology-agnostic architecture specification (WHAT, not HOW) - defines capabilities, data models, interfaces, architectural decisions | Enterprise Architects, Technical Leads | JSON (~38KB) |

### Migration Guides

| Document | Purpose | Audience | Size |
|----------|---------|----------|------|
| **[Migration-Guide-Vue.js.md](./Migration-Guide-Vue.js.md)** | Complete guide for migrating from Vanilla JavaScript to Vue.js without changing architecture | Frontend Developers | ~36KB |

---

## 🚀 Quick Start

### For New Team Members
1. Start with **[Architecture-Quick-Reference.md](./Architecture-Quick-Reference.md)** - Get familiar with the 5 core patterns
2. Review **[Architecture-Diagrams.md](./Architecture-Diagrams.md)** - Understand the visual architecture
3. Deep dive into **[Architecture.md](./Architecture.md)** - Learn the complete system

### For Developers
1. Review **[Architecture.md → API Architecture](./Architecture.md#api-architecture)** - All 28 API endpoints
2. Review **[Architecture.md → Component Architecture](./Architecture.md#component-architecture)** - Service responsibilities
3. Review **[Architecture-Quick-Reference.md → Data Flow Patterns](./Architecture-Quick-Reference.md#data-flow-patterns)** - Common workflows

### For DevOps/Infrastructure
1. Review **[Architecture.md → Deployment Architecture](./Architecture.md#deployment-architecture)** - Docker + Kubernetes setup
2. Review **[Architecture.md → Security Architecture](./Architecture.md#security-architecture)** - Security hardening
3. Review **[Architecture-Quick-Reference.md → Deployment Checklist](./Architecture-Quick-Reference.md#deployment-checklist)** - Step-by-step deployment

### For Architects
1. Review **[Self-Service-Infra.AppArchitect.json](../Self-Service-Infra.AppArchitect.json)** - Technology-agnostic specification (WHAT, not HOW)
2. Review **[Architecture-vs-Technology.md](./Architecture-vs-Technology.md)** - Understand architecture/technology separation
3. Review **[Architecture.md → Core Architecture Patterns](./Architecture.md#core-architecture-patterns)** - 5 foundational patterns
4. Review **[Architecture.md → System Architecture](./Architecture.md#system-architecture)** - Component topology
5. Review **[Architecture.md → Quality Attributes](./Architecture.md#quality-attributes)** - Performance, scalability, reliability

---

## 🏗️ Architecture Overview

### What is SelfService Infrastructure Catalog?

A **web-based self-service platform** for provisioning and managing Azure infrastructure using standardized Terraform modules with GitOps-driven workflows.

### Key Design Principles

1. **GitHub as Database**: No traditional database - GitHub repository is the source of truth
2. **Dual GitHub Apps**: Separate apps for infrastructure vs. code operations
3. **Correlation ID Tracking**: End-to-end request tracing across all systems
4. **SPA Navigation**: Simple vanilla JavaScript SPA without frameworks
5. **Workflow Polling**: Client-side polling for real-time status updates

### Technology Stack

```
Frontend:  Vanilla JavaScript SPA (HTML/CSS/JS)
Backend:   Node.js 18+ + Express.js
Auth:      Dual GitHub Apps (JWT tokens)
Data:      GitHub repository (docs/metadata/)
CI/CD:     GitHub Actions + Terraform
Deploy:    Docker + Kubernetes (AKS)
Logging:   Winston with correlation IDs
```

---

## 📖 Document Guide

### Architecture.md (Comprehensive Specification)

**Sections**:
1. Executive Summary
2. System Overview with high-level diagrams
3. Core Architecture Patterns (5 foundational patterns)
4. System Architecture (layered architecture)
5. Component Architecture (all services documented)
6. Data Architecture (storage strategy, schemas, flows)
7. API Architecture (all 28 endpoints)
8. Frontend Architecture (SPA structure, navigation)
9. Workflow Management (GitHub Actions workflows)
10. Security Architecture (authentication, validation)
11. Deployment Architecture (Docker, Kubernetes)
12. Integration Architecture (external systems)
13. Quality Attributes (performance, scalability)
14. Future Enhancements (roadmap)

**Best For**:
- Comprehensive system understanding
- Onboarding senior engineers
- Architecture decision making
- Technical documentation for stakeholders

**Key Diagrams**:
- 14+ Mermaid diagrams covering all architectural aspects
- Sequence diagrams for data flows
- Component diagrams for system topology
- State diagrams for workflows

---

### Architecture-Quick-Reference.md (Quick Access Guide)

**Sections**:
1. System at a Glance
2. 5 Core Architecture Patterns (summary)
3. Component Map (visual file structure)
4. API Quick Reference (table format)
5. Data Flow Patterns (3 common workflows)
6. Security Checklist
7. Deployment Checklist
8. Troubleshooting Guide
9. Performance Targets
10. Common Workflows (step-by-step)

**Best For**:
- Quick lookups during development
- API endpoint reference
- Deployment procedures
- Troubleshooting issues

**Key Features**:
- Concise tables for quick scanning
- Step-by-step checklists
- Common problem solutions
- Performance benchmarks

---

### Architecture-Diagrams.md (Visual Diagram Index)

**Sections**:
1. System Architecture Diagrams (2)
2. Data Flow Diagrams (4)
3. Component Diagrams (3)
4. Workflow Diagrams (3)
5. Deployment Diagrams (2)
6. Security Diagrams (1)
7. Integration Diagrams (1)

**Best For**:
- Visual learners
- Presentation materials
- High-level overviews
- Stakeholder communications

**Key Features**:
- All 16 Mermaid diagrams in one place
- Context for each diagram
- Quick navigation to full documentation

---

### Self-Service-Infra.AppArchitect.json (Technology-Agnostic Specification)

**Purpose**: Defines WHAT the system does, not HOW it's implemented. Enables technology stack changes without architectural redesign.

**Structure**:
```json
{
  "coreDomains": {
    "infrastructureManagement": { "capabilities": [...] },
    "containerApplicationDeployment": { "capabilities": [...] },
    "accessControlManagement": { "capabilities": [...] },
    "workflowOrchestration": { "capabilities": [...] },
    "userInterface": { "capabilities": [...] }
  },
  "dataModels": {
    "infrastructure": { "attributes": {...}, "relationships": {...} },
    "workflow": { "attributes": {...} },
    "module": { "attributes": {...} },
    "template": { "attributes": {...} }
  },
  "interfaces": {
    "userToSystem": { "channels": [...] },
    "systemToVersionControl": { "channels": [...] },
    "systemToCloudProvider": { "channels": [...] }
  },
  "architecturalDecisions": {
    "AD001_GitOpsAsSourceOfTruth": { "decision", "rationale", "tradeoffs" },
    "AD002_StatelessBackend": { ... },
    "AD003_ClientSidePolling": { ... },
    "AD004_CorrelationIDTracking": { ... },
    "AD005_ApprovalViaVersionControl": { ... },
    "AD006_DeclarativeInfrastructure": { ... },
    "AD007_MultiApplicationAuthentication": { ... }
  },
  "dataFlows": { "provisionInfrastructure": {...}, "deleteInfrastructure": {...} },
  "qualityAttributes": { "scalability", "reliability", "security", "usability" },
  "migrationConsiderations": {
    "frontendFrameworkMigration": { "architecturalStability": [...] },
    "backendLanguageMigration": { ... },
    "authenticationMigration": { ... }
  }
}
```

**Best For**:
- Enterprise architects defining long-term strategy
- Technology evaluations (moving from Node.js to Go, Vanilla JS to Vue)
- Architecture reviews independent of implementation
- Ensuring architectural stability across tech stack changes

**Key Insight**: This specification focuses exclusively on business capabilities, data contracts, and architectural decisions - the technology stack is a separate concern.

---

### Migration-Guide-Vue.js.md (Framework Migration Guide)

**Purpose**: Step-by-step guide for migrating from Vanilla JavaScript to Vue.js while preserving all architectural patterns.

**Sections**:
1. Architecture Stability During Migration (what doesn't change)
2. Component Mapping (Vanilla JS → Vue Components)
3. State Management Strategy (Pinia stores)
4. API Integration (centralized Axios service)
5. Routing Strategy (Vue Router)
6. Migration Phases (7-week plan)
7. Code Examples (before/after comparisons)
8. Testing Strategy (Vitest + Playwright)
9. Rollback Plan (parallel deployment strategy)

**Best For**:
- Frontend developers planning framework migration
- Technical leads evaluating Vue.js adoption
- Understanding how architecture remains stable across tech changes

**Key Insight**: All 7 architectural decisions from the JSON spec remain valid during migration - only implementation details change.

**Migration Table**:

| Architecture Element | Vanilla JS | Vue.js | Stability |
|---------------------|------------|--------|-----------|
| Data Models | JavaScript objects | TypeScript interfaces | ✅ Unchanged |
| API Contracts | Fetch calls | Axios service | ✅ Same endpoints |
| Correlation IDs | Manual UUID | UUID library | ✅ Same pattern |
| Workflow Polling | setInterval | Vue store + computed | ✅ Same mechanism |
| Stateless Backend | No sessions | No sessions | ✅ Unchanged |

---

## 🔑 Key Architecture Patterns

### 1. GitHub as Database

**What**: Application metadata stored as JSON files in `docs/metadata/` folder of GitHub repository

**Why**: Version control, audit trail, no database ops

**Trade-offs**: Limited queries, API rate limits, eventual consistency

**Diagram**: See Architecture.md → Core Architecture Patterns → GitHub as Database

---

### 2. Multi-GitHub-App Pattern

**What**: Separate GitHub Apps for infrastructure operations vs. code deployment

**Why**: Least privilege, failure isolation, separate audit trails

**Responsibilities**:
- **Infrastructure App**: Terraform workflows, metadata management
- **Code App**: AKS deployments, application code

**Diagram**: See Architecture.md → Core Architecture Patterns → Multi-GitHub-App

---

### 3. Correlation ID Tracking

**What**: UUID generated on request, threaded through entire operation

**Format**: `cid-{timestamp}-{random}` (e.g., `cid-1737406800-a4f9`)

**Flow**: Browser → API → Services → GitHub workflow → Status polling → Logs

**Benefits**: End-to-end traceability, distributed debugging, audit compliance

**Diagram**: See Architecture.md → Core Architecture Patterns → Correlation ID Tracking

---

### 4. SPA Navigation (No Router)

**What**: Single HTML file with multiple `.page` divs, toggled via JavaScript

**How**: `navigateToPage()` function hides all pages, shows selected one

**Why**: Simplicity, no dependencies, fast performance

**Trade-offs**: No URL routing, no browser history, manual state management

**Diagram**: See Architecture.md → Core Architecture Patterns → SPA Navigation

---

### 5. Workflow Polling

**What**: Client polls `/api/workflow-status?correlationId=X` every 10 seconds

**Response**: `{status, percentage, prUrl, workflowUrl, message}`

**Why**: Stateless backend, real-time UX, no webhook infrastructure

**Timeout**: Max 20 polls (~3.3 minutes), then manual check option

**Diagram**: See Architecture.md → Core Architecture Patterns → Workflow Polling

---

## 🌟 System Highlights

### No Database
✅ GitHub repository is source of truth  
✅ Full version control and audit trail  
✅ No database operations overhead  
✅ Cost savings  

### Dual GitHub Apps
✅ Least privilege access control  
✅ Failure isolation  
✅ Separate audit trails  
✅ Security best practices  

### Correlation ID Tracking
✅ End-to-end request tracing  
✅ Distributed debugging  
✅ Audit compliance  
✅ Observability by default  

### GitOps-Driven
✅ Infrastructure as code  
✅ Declarative configuration  
✅ Git-based workflows  
✅ Automated deployments  

### Stateless Backend
✅ Horizontal scalability  
✅ No session management  
✅ Kubernetes-friendly  
✅ Cloud-native architecture  

---

## 📊 Quick Statistics

### Codebase
- **Backend Services**: 5 (GitHub, Infrastructure, AKS, Database, HCL Parser)
- **API Endpoints**: 28 (REST APIs)
- **Frontend Pages**: 5 + 5 modals
- **GitHub Workflows**: 5+ (create, delete, promote, AKS deploy, etc.)

### Architecture Documentation
- **Total Lines**: 2,795+ lines
- **Total Size**: 88KB
- **Diagrams**: 16+ Mermaid diagrams
- **Code Examples**: 100+
- **API Specs**: Complete reference for 28 endpoints

### Technology Stack
- **Languages**: JavaScript (Node.js 18+), HCL (Terraform)
- **Frameworks**: Express.js (backend), Vanilla JS (frontend)
- **Infrastructure**: Docker, Kubernetes (AKS)
- **CI/CD**: GitHub Actions
- **Cloud**: Azure (VMs, Storage, KeyVault, SQL, AKS, ACR)

---

## 🔗 Related Documentation

### Security & Authentication
- [✅ Entra ID Integration Plan](./entra-id-integration-plan.md) - **COMPLETED** - Azure AD authentication implementation
- [Authentication Guide](./AUTHENTICATION-GUIDE.md) - Complete setup, usage, and troubleshooting guide
- [Testing Checklist](./TESTING-CHECKLIST.md) - Comprehensive authentication test scenarios
- [Entra ID Quick Start](./entra-id-quick-start.md) - Quick setup guide (legacy)
- [Entra ID Implementation Summary](./entra-id-implementation-summary.md) - Implementation details (legacy)

### Feature-Specific
- [Multi-Instance Feature](./multi-instance-feature.md) - Multiple environment support
- [Cross-Org Workflow Authentication](./cross-org-workflow-authentication.md) - GitHub App authentication

### Operational
- [Workflow Data Preparation](./workflow-data-preparation.md) - Workflow configuration

---

## 🛠️ Common Tasks

### View System Architecture
```bash
# Open comprehensive architecture doc
open docs/Architecture.md

# Or quick reference
open docs/Architecture-Quick-Reference.md
```

### Find an API Endpoint
1. Open [Architecture.md → API Architecture](./Architecture.md#api-architecture)
2. Search for endpoint name
3. Review request/response format

### Understand a Data Flow
1. Open [Architecture-Diagrams.md → Data Flow Diagrams](./Architecture-Diagrams.md#data-flow-diagrams)
2. Find relevant sequence diagram
3. Trace the flow step-by-step

### Deploy the Application
1. Review [Architecture-Quick-Reference.md → Deployment Checklist](./Architecture-Quick-Reference.md#deployment-checklist)
2. Follow step-by-step instructions
3. Verify health check: `curl /health`

---

## 📝 Documentation Maintenance

### Update Frequency
- **Architecture.md**: Update when major architectural changes occur
- **Architecture-Quick-Reference.md**: Update when APIs or workflows change
- **Architecture-Diagrams.md**: Update when new diagrams are added

### Review Cadence
- **Quarterly**: Review for accuracy and completeness
- **Before Major Releases**: Ensure docs reflect latest changes
- **After Incidents**: Update with lessons learned

### Version Control
- All documentation versioned with code
- Major updates increment version number
- `Last Updated` date tracks freshness

---

## 💡 Tips for Using This Documentation

### For Quick Answers
→ Use **Architecture-Quick-Reference.md** for fast lookups

### For Deep Understanding
→ Use **Architecture.md** for comprehensive explanations

### For Visual Learning
→ Use **Architecture-Diagrams.md** for diagrams and flows

### For Presentations
→ Extract diagrams from **Architecture-Diagrams.md**

### For Onboarding
→ Start with Quick Reference → Diagrams → Full Architecture

---

## 🤝 Contributing

### Updating Documentation

1. **Small Changes**: Edit directly in docs/
2. **Major Changes**: Create feature branch, update docs, submit PR
3. **New Diagrams**: Add to Architecture.md and Architecture-Diagrams.md

### Diagram Guidelines

- Use Mermaid format for consistency
- Embed diagrams in markdown (not separate files)
- Include context before each diagram
- Add key points after diagram

### Writing Style

- Use clear, concise language
- Include code examples where relevant
- Add diagrams for complex flows
- Link to related documentation

---

## 📞 Support

### Questions?
- **Architecture Questions**: Review [Architecture.md](./Architecture.md)
- **Quick Lookups**: Check [Architecture-Quick-Reference.md](./Architecture-Quick-Reference.md)
- **Visual Reference**: See [Architecture-Diagrams.md](./Architecture-Diagrams.md)

### Issues?
- Check [Architecture-Quick-Reference.md → Troubleshooting](./Architecture-Quick-Reference.md#troubleshooting)
- Review logs with correlation IDs
- Contact DevOps team

---

## 📜 Document History

### Version 2.0 (2024-01-20)
- ✅ Complete architecture review performed
- ✅ Comprehensive Architecture.md created (1,893 lines)
- ✅ Quick Reference guide created (402 lines)
- ✅ Diagram index created (16+ diagrams)
- ✅ All 28 API endpoints documented
- ✅ All 5 core patterns explained
- ✅ Security, deployment, and quality attributes specified

### Version 1.0 (Previous)
- Basic architecture overview (140 lines)
- Limited diagrams
- Minimal component documentation

---

## ✅ Documentation Checklist

- [x] System overview with high-level architecture
- [x] Core architecture patterns documented (5 patterns)
- [x] All backend services documented (5 services)
- [x] All API endpoints documented (28 endpoints)
- [x] Frontend architecture explained (SPA navigation)
- [x] Workflow management documented (GitHub Actions)
- [x] Security architecture specified (auth, validation)
- [x] Deployment architecture detailed (Docker, K8s)
- [x] Data flows diagrammed (sequence diagrams)
- [x] Integration patterns explained (GitHub, Azure)
- [x] Quality attributes defined (performance, scalability)
- [x] Future enhancements roadmap provided
- [x] Quick reference guide created
- [x] Diagram index created
- [x] Troubleshooting guide provided
- [x] Deployment checklist provided

---

**Ready to dive in?** Start with [Architecture-Quick-Reference.md](./Architecture-Quick-Reference.md) for a quick overview, or jump straight to [Architecture.md](./Architecture.md) for the complete specification!

---

**Document Version**: 2.0  
**Last Updated**: 2024-01-20  
**Maintained By**: DevOps Team  
**Contact**: devops@example.com
