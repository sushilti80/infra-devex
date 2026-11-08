# SelfService Infrastructure Catalog - Architecture Diagram Index

**Version**: 2.0  
**Last Updated**: 2024-01-20  

> This document provides quick access to all architecture diagrams. For full context, see [Architecture.md](./Architecture.md)

---

## Table of Contents

1. [System Architecture Diagrams](#system-architecture-diagrams)
2. [Data Flow Diagrams](#data-flow-diagrams)
3. [Component Diagrams](#component-diagrams)
4. [Workflow Diagrams](#workflow-diagrams)
5. [Deployment Diagrams](#deployment-diagrams)
6. [Security Diagrams](#security-diagrams)

---

## System Architecture Diagrams

### High-Level System Architecture

**Location**: Architecture.md → System Overview → High-Level Architecture

**Shows**: Complete system topology with all major components

```mermaid
graph TB
    Browser[Web Browser] -->|HTTPS| Express[Express API]
    Express --> GitHubSvc[GitHub Service]
    Express --> InfraSvc[Infrastructure Service]
    Express --> AKSSvc[AKS Service]
    
    GitHubSvc -->|Auth| InfraApp[Infrastructure GitHub App]
    GitHubSvc -->|Auth| CodeApp[Code GitHub App]
    
    GitHubSvc -->|API| ServiceRepo[service-catalog]
    GitHubSvc -->|API| FluxRepo[flux-config]
    
    InfraSvc -->|Trigger| GHActions[GitHub Actions]
    GHActions -->|Execute| Terraform
    Terraform -->|Provision| Azure[Azure Resources]
    
    AKSSvc -->|Trigger| GHActions
    GHActions -->|Deploy| AKS[Azure Kubernetes Service]
```

**Key Points**:
- Browser communicates with Express API via HTTPS
- Dual GitHub Apps for infrastructure and code operations
- GitHub Actions orchestrates infrastructure provisioning and deployments
- Azure resources provisioned via Terraform
- AKS deployments via GitOps (Flux)

---

### Layered Architecture

**Location**: Architecture.md → System Architecture → Layered Architecture

**Shows**: Application layers from presentation to data

```mermaid
graph TB
    subgraph "Presentation Layer"
        UI[SPA Frontend]
    end
    
    subgraph "API Layer"
        Routes[Express Routes]
        Middleware[Middleware]
    end
    
    subgraph "Business Logic Layer"
        InfraSvc[Infrastructure Service]
        AKSSvc[AKS Service]
        GitHubSvc[GitHub Service]
    end
    
    subgraph "Integration Layer"
        Octokit[Octokit SDK]
    end
    
    subgraph "Data Layer"
        MetadataFolder[docs/metadata/]
        Templates[data/templates.json]
        Modules[data/modules.json]
    end
    
    UI --> Routes
    Routes --> Middleware
    Middleware --> InfraSvc
    Middleware --> AKSSvc
    InfraSvc --> GitHubSvc
    GitHubSvc --> Octokit
    GitHubSvc -.->|Read| MetadataFolder
```

**Key Points**:
- Clear separation of concerns across layers
- Business logic isolated in service layer
- Data layer uses GitHub as source of truth
- No database required

---

## Data Flow Diagrams

### GitHub as Database Pattern

**Location**: Architecture.md → Core Architecture Patterns → GitHub as Database

**Shows**: How metadata is fetched from GitHub repository

```mermaid
sequenceDiagram
    participant API as Express API
    participant GH as GitHub Service
    participant Repo as service-catalog Repository
    
    API->>GH: getInstalledApps()
    GH->>Repo: GET /repos/.../contents/docs/metadata
    Repo-->>GH: [file1.json, file2.json, ...]
    loop For each JSON file
        GH->>Repo: GET /repos/.../contents/docs/metadata/file.json
        Repo-->>GH: base64 encoded content
        GH->>GH: Decode & parse JSON
    end
    GH-->>API: Array of application objects
```

**Key Points**:
- GitHub repository is the single source of truth
- Metadata stored as JSON files in `docs/metadata/`
- No database synchronization required
- Full version control and audit trail

---

### Correlation ID Tracking

**Location**: Architecture.md → Core Architecture Patterns → Correlation ID Tracking

**Shows**: How correlation IDs flow through the entire system

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant GitHubSvc
    participant Workflow
    participant Log
    
    Browser->>Browser: Generate correlationId<br/>cid-{timestamp}-{random}
    Browser->>API: POST /api/custom<br/>{correlationId, ...}
    API->>Log: Log request [correlationId]
    API->>GitHubSvc: triggerWorkflow(correlationId, ...)
    GitHubSvc->>Log: Log workflow trigger [correlationId]
    GitHubSvc->>Workflow: Dispatch workflow<br/>PR description includes correlationId
    Workflow->>Workflow: Execute workflow<br/>correlationId in PR body
    Browser->>API: GET /api/status/{correlationId}
    API->>GitHubSvc: getWorkflowStatusByCorrelationId()
    GitHubSvc->>GitHubSvc: Search PRs by correlationId
    GitHubSvc-->>API: {status, prUrl, workflowUrl}
    API-->>Browser: {status, correlationId, ...}
```

**Key Points**:
- Correlation ID generated on client side
- Threaded through entire request lifecycle
- Stored in GitHub PR descriptions for tracking
- Enables end-to-end request tracing

---

### Workflow Polling Pattern

**Location**: Architecture.md → Core Architecture Patterns → Workflow Polling

**Shows**: How clients poll for workflow status updates

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant GitHub
    
    Browser->>API: POST /api/custom<br/>{correlationId, ...}
    API-->>Browser: {success: true, correlationId}
    
    loop Poll every 10s (max 20 times)
        Browser->>API: GET /api/status/{correlationId}
        API->>GitHub: Search PRs by correlationId
        GitHub-->>API: PR details & workflow runs
        API->>GitHub: Get workflow run status
        GitHub-->>API: {status, conclusion}
        API-->>Browser: {status, percentage, prUrl, message}
        
        alt Status: completed
            Browser->>Browser: Stop polling<br/>Show success
        else Status: failed
            Browser->>Browser: Stop polling<br/>Show error
        else Status: queued/in_progress
            Browser->>Browser: Continue polling<br/>Update progress bar
        end
    end
```

**Key Points**:
- Client-initiated polling every 10 seconds
- Stateless backend (no session storage)
- Automatic timeout after ~3.3 minutes
- Progress bar updates based on status

---

### Read Pattern: Fetch Installed Applications

**Location**: Architecture.md → Data Architecture → Data Flow Patterns

**Shows**: Complete flow for fetching application list

```mermaid
sequenceDiagram
    participant Browser
    participant API as Express API
    participant InfraSvc as Infrastructure Service
    participant GitHubSvc as GitHub Service
    participant Repo as GitHub Repository
    
    Browser->>API: GET /api/installed-apps
    API->>InfraSvc: getInstalledApps()
    InfraSvc->>GitHubSvc: octokit.repos.getContent(docs/metadata)
    GitHubSvc->>Repo: List files in docs/metadata/
    Repo-->>GitHubSvc: [file1.json, file2.json, ...]
    
    loop For each JSON file
        GitHubSvc->>Repo: Get file content (base64)
        Repo-->>GitHubSvc: Base64 encoded JSON
        GitHubSvc->>GitHubSvc: Decode & parse JSON
    end
    
    GitHubSvc-->>InfraSvc: Array of app objects
    InfraSvc->>InfraSvc: Transform to frontend format
    InfraSvc-->>API: Formatted apps array
    API-->>Browser: {success, count, data, correlationId}
```

**Key Points**:
- Parallel fetching of metadata files
- Base64 decoding and JSON parsing
- Data transformation for frontend consumption
- Includes correlation ID in response

---

### Write Pattern: Create Infrastructure

**Location**: Architecture.md → Data Architecture → Data Flow Patterns

**Shows**: Infrastructure creation workflow from request to completion

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant InfraSvc
    participant GitHubSvc
    participant Workflow
    participant Terraform
    participant Azure
    
    Browser->>API: POST /api/custom<br/>{projectName, modules, ...}
    API->>InfraSvc: buildCustomInfrastructure(...)
    InfraSvc->>InfraSvc: Generate correlationId
    InfraSvc->>GitHubSvc: triggerWorkflow(create-infrastructure)
    GitHubSvc->>Workflow: Dispatch workflow<br/>Include correlationId in inputs
    Workflow->>Workflow: Create PR with metadata
    Workflow->>Terraform: terraform plan & apply
    Terraform->>Azure: Provision resources
    Workflow->>Workflow: Create metadata JSON file
    Workflow->>Workflow: Commit to docs/metadata/
```

**Key Points**:
- Infrastructure provisioned via GitHub Actions workflow
- Terraform plans and applies changes
- Metadata JSON created and committed to repository
- Client polls for status using correlation ID

---

## Component Diagrams

### Multi-GitHub-App Architecture

**Location**: Architecture.md → Core Architecture Patterns → Multi-GitHub-App Pattern

**Shows**: Separation of infrastructure and code operations

```mermaid
graph LR
    subgraph "Infrastructure Operations"
        InfraApp[GitHub App<br/>Infrastructure]
        ServiceRepo[service-catalog<br/>Repository]
        InfraWorkflows[create-infrastructure<br/>delete-infrastructure<br/>move-to-infralive<br/>UpdateMetadataLive]
    end
    
    subgraph "Code Operations"
        CodeApp[GitHub App<br/>Code Deployment]
        FluxRepo[flux-config<br/>Repository]
        CodeWorkflows[generate-app<br/>create-app]
    end
    
    InfraApp -->|Trigger| InfraWorkflows
    InfraApp -->|Read/Write| ServiceRepo
    CodeApp -->|Trigger| CodeWorkflows
    CodeApp -->|Read/Write| FluxRepo
```

**Key Points**:
- Separate GitHub Apps for different concerns
- Infrastructure App: Terraform workflows, metadata management
- Code App: AKS deployments, application code
- Least privilege access control

---

### Frontend SPA Structure

**Location**: Architecture.md → Frontend Architecture → Single Page Application Structure

**Shows**: Page sections and modals in the SPA

```mermaid
graph TB
    subgraph "index.html"
        Page1[.page#home<br/>Landing Page]
        Page2[.page#custom<br/>Custom Infrastructure]
        Page3[.page#template<br/>Template Deploy]
        Page4[.page#aks<br/>AKS Deploy]
        Page5[.page#installed<br/>Installed Apps]
    end
    
    subgraph "Modals"
        StatusModal[Status Modal<br/>Workflow Progress]
        DeleteModal[Delete Confirmation]
        PromoteModal[Promote to Production]
        LabelModal[Label Modal]
        RBACModal[RBAC Manager]
    end
    
    subgraph "JavaScript Modules"
        AppJS[app.js<br/>Core Logic]
        RBACJS[rbac-manager.js<br/>RBAC UI]
    end
    
    AppJS -->|Show/Hide| Page1
    AppJS -->|Show/Hide| Page2
    AppJS -->|Control| StatusModal
    RBACJS -->|Control| RBACModal
```

**Key Points**:
- 5 main page sections (hidden/visible via CSS)
- 5 modal overlays for user interactions
- app.js handles core navigation and forms
- rbac-manager.js handles RBAC-specific UI

---

### Data Storage Architecture

**Location**: Architecture.md → Data Architecture → Data Storage Strategy

**Shows**: How data is stored and cached

```mermaid
graph TB
    subgraph "Primary Data Store - GitHub Repository"
        MetadataFolder[docs/metadata/<br/>Application Metadata]
        Templates[data/templates.json<br/>Infrastructure Templates]
        Modules[data/modules.json<br/>Terraform Modules]
    end
    
    subgraph "In-Memory Cache"
        TemplateCache[Templates Array]
        ModuleCache[Modules Array]
    end
    
    MetadataFolder -.->|Read on demand| API[API Layer]
    Templates -.->|Load at startup| TemplateCache
    Modules -.->|Load at startup| ModuleCache
    
    API -->|Write| MetadataFolder
    API -->|Read| TemplateCache
    API -->|Read| ModuleCache
```

**Key Points**:
- GitHub repository is primary data store
- Templates and modules cached in memory at startup
- Metadata fetched on demand from GitHub
- No traditional database required

---

## Workflow Diagrams

### SPA Navigation Flow

**Location**: Architecture.md → Frontend Architecture → Navigation Flow

**Shows**: State transitions between pages

```mermaid
stateDiagram-v2
    [*] --> Home: Page Load
    
    Home --> Custom: Click "Custom Infrastructure"
    Home --> Template: Click "Template Deploy"
    Home --> AKS: Click "AKS Deploy"
    Home --> Installed: Click "Installed Apps"
    
    Custom --> StatusModal: Submit Form
    Template --> StatusModal: Submit Form
    AKS --> StatusModal: Submit Form
    
    Installed --> DeleteModal: Click "Delete"
    Installed --> PromoteModal: Click "Promote"
    
    StatusModal --> Installed: Success/Failure
```

**Key Points**:
- Simple state machine for page navigation
- Form submissions trigger status modals
- Modals show workflow progress
- Success/failure returns to appropriate page

---

### Workflow Status Lifecycle

**Location**: Architecture.md → Workflow Management → Workflow Status Lifecycle

**Shows**: Workflow status state transitions

```mermaid
stateDiagram-v2
    [*] --> Queued: Workflow Dispatched
    
    Queued --> InProgress: Runner Assigned
    Queued --> Failed: Invalid Inputs
    
    InProgress --> Completed: All Steps Pass
    InProgress --> Failed: Step Failure
    InProgress --> Cancelled: User Cancellation
    
    Completed --> [*]
    Failed --> [*]
    Cancelled --> [*]
    
    note right of Queued
        Status: queued
        Percentage: 0%
    end note
    
    note right of InProgress
        Status: in_progress
        Percentage: 50%
    end note
    
    note right of Completed
        Status: completed
        Conclusion: success
        Percentage: 100%
    end note
```

**Key Points**:
- Workflow starts in "queued" state
- Transitions to "in_progress" when runner assigned
- Completes with "success" or "failure"
- Client polls and updates progress bar

---

### Progress Feedback Flow

**Location**: Architecture.md → Frontend Architecture → UI/UX Patterns

**Shows**: User feedback during workflow execution

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Poll
    participant API
    
    User->>UI: Submit Form
    UI->>UI: Generate correlationId
    UI->>API: POST /api/custom
    API-->>UI: {success, correlationId}
    UI->>UI: Show Status Modal<br/>"Workflow queued..."
    
    loop Every 10 seconds
        Poll->>API: GET /api/status/{correlationId}
        API-->>Poll: {status, percentage, prUrl}
        
        alt Status: queued
            Poll->>UI: Update: "Queued (0%)"
        else Status: in_progress
            Poll->>UI: Update: "In Progress (50%)"
        else Status: completed
            Poll->>UI: Update: "Success! (100%)"
            Poll->>Poll: Stop polling
        end
    end
```

**Key Points**:
- Immediate feedback with status modal
- Progress bar shows visual progress
- Polling continues until completion
- Links to PR and workflow provided

---

## Deployment Diagrams

### Kubernetes Deployment Architecture

**Location**: Architecture.md → Deployment Architecture → Kubernetes Deployment

**Shows**: Complete K8s deployment topology

```mermaid
graph TB
    subgraph "AKS Cluster"
        subgraph "Namespace: self-service-test"
            Ingress[NGINX Ingress<br/>self-service.example.com]
            Service[Service<br/>Port 80]
            Deployment[Deployment<br/>self-service-app]
            Pod1[Pod 1]
            Pod2[Pod 2]
            ConfigMap[ConfigMap]
            Secret[Secret]
        end
    end
    
    User[User Browser] -->|HTTPS| Ingress
    Ingress -->|HTTP| Service
    Service -->|Load Balance| Pod1
    Service -->|Load Balance| Pod2
    
    Deployment -->|Manages| Pod1
    Deployment -->|Manages| Pod2
    
    Pod1 -.->|Read| ConfigMap
    Pod1 -.->|Read| Secret
    Pod2 -.->|Read| ConfigMap
    Pod2 -.->|Read| Secret
```

**Key Points**:
- NGINX ingress for external access
- Service load balances across pods
- ConfigMap for non-sensitive configuration
- Secret for GitHub keys and Azure credentials
- Multiple pod replicas for high availability

---

### CI/CD Pipeline Flow

**Location**: Architecture.md → Deployment Architecture → CI/CD Pipeline

**Shows**: Complete deployment pipeline from code to production

```mermaid
graph LR
    Dev[Developer] -->|Git Push| GitHub[GitHub Repository]
    GitHub -->|Trigger| Pipeline[CI/CD Pipeline]
    Pipeline -->|Build| Docker[Docker Build]
    Docker -->|Push| ACR[Azure Container Registry]
    ACR -->|Pull| AKS[AKS Cluster]
    Pipeline -->|Update| Flux[Flux Repository]
    Flux -->|GitOps| AKS
```

**Key Points**:
- Git push triggers CI/CD pipeline
- Docker image built and pushed to ACR
- Flux repository updated with new image tag
- Flux operator syncs changes to AKS
- GitOps ensures declarative infrastructure

---

## Security Diagrams

### Authentication Architecture

**Location**: Architecture.md → Security Architecture → Authentication & Authorization

**Shows**: Multi-layered authentication

```mermaid
graph TB
    subgraph "GitHub App Authentication"
        InfraApp[Infrastructure GitHub App<br/>App ID + Private Key]
        CodeApp[Code Deployment GitHub App<br/>App ID + Private Key]
    end
    
    subgraph "API Layer"
        Express[Express API Server]
        CORS[CORS Middleware]
        Validator[Input Validation]
    end
    
    subgraph "GitHub API"
        ServiceRepo[service-catalog]
        FluxRepo[flux-config]
    end
    
    InfraApp -->|JWT Token| Express
    CodeApp -->|JWT Token| Express
    
    Express --> CORS
    CORS --> Validator
    Validator --> GitHubAPI[GitHub API Calls]
    
    GitHubAPI -->|Infrastructure App Token| ServiceRepo
    GitHubAPI -->|Code App Token| FluxRepo
```

**Key Points**:
- Dual GitHub Apps with separate credentials
- JWT tokens for API authentication
- CORS middleware for cross-origin security
- Input validation on all requests
- Least privilege access per GitHub App

---

## Integration Diagrams

### External System Integration

**Location**: Architecture.md → Integration Architecture → External System Integration

**Shows**: All external system connections

```mermaid
graph TB
    subgraph "SelfService Application"
        API[Express API]
    end
    
    subgraph "GitHub"
        ServiceRepo[service-catalog]
        FluxRepo[flux-config]
        ModulesRepo[terraform-modules]
        GHActions[GitHub Actions]
    end
    
    subgraph "Azure"
        ACR[Container Registry]
        AKS[Kubernetes Service]
        VM[Virtual Machines]
        Storage[Storage Accounts]
        KeyVault[Key Vault]
    end
    
    API -->|REST API| ServiceRepo
    API -->|REST API| FluxRepo
    API -->|Trigger| GHActions
    
    GHActions -->|Terraform| VM
    GHActions -->|Terraform| Storage
    GHActions -->|Terraform| KeyVault
    GHActions -->|Deploy| AKS
    
    AKS -->|Pull Image| ACR
```

**Key Points**:
- GitHub for metadata storage and workflows
- GitHub Actions for infrastructure automation
- Terraform provisions Azure resources
- AKS pulls container images from ACR
- GitOps pattern for Kubernetes deployments

---

## Summary

This document provides an index to all architecture diagrams in the SelfService Infrastructure Catalog system. Each diagram is referenced with its location in the main [Architecture.md](./Architecture.md) document.

### Diagram Categories

- **System Architecture**: 2 diagrams (High-level, Layered)
- **Data Flow**: 4 diagrams (GitHub DB, Correlation ID, Polling, CRUD)
- **Component**: 3 diagrams (Multi-App, Frontend, Data Storage)
- **Workflow**: 3 diagrams (Navigation, Status Lifecycle, Progress Feedback)
- **Deployment**: 2 diagrams (Kubernetes, CI/CD)
- **Security**: 1 diagram (Authentication)
- **Integration**: 1 diagram (External Systems)

**Total**: 16 comprehensive architecture diagrams

---

**For Full Documentation**: See [Architecture.md](./Architecture.md) for complete architectural details, code examples, API specifications, and more.

**For Quick Reference**: See [Architecture-Quick-Reference.md](./Architecture-Quick-Reference.md) for quick access to key patterns, API endpoints, and checklists.

---

**Document Version**: 2.0  
**Last Updated**: 2024-01-20  
**Maintained By**: DevOps Team
