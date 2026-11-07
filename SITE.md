# Self-Service Infrastructure Catalog

**Version**: 1.0  
**Last Updated**: January 27, 2026  
**Stitch Project ID**: 18176568726526784208

---

## 1. Site Vision

A modern, minimalistic enterprise SaaS platform that enables teams to provision, deploy, and manage Azure infrastructure using standardized Terraform modules. The platform follows a self-service model where developers can:

- **Build custom infrastructure** by selecting and composing Azure modules
- **Deploy from templates** using pre-configured infrastructure patterns
- **Deploy to AKS** for containerized applications
- **Manage infrastructure** with full lifecycle operations (view, label, promote, delete)
- **Define RBAC relationships** between Azure resources
- **Track workflows** with real-time status updates and correlation IDs

### Target Audience
- DevOps Engineers
- Platform Engineers
- Application Developers
- Infrastructure Teams

### Key Differentiators
- GitHub as database (no traditional DB)
- Multi-GitHub-App pattern for security
- Correlation ID tracking for end-to-end traceability
- GitOps-driven architecture
- Enterprise-grade with minimalistic design

---

## 2. Technical Context

### Architecture Compliance
All designs MUST adhere to `Self-Service-Infra.AppArchitect.json` specification v2.0.0:

**Core Domains**:
1. `infrastructureManagement` - Provisioning, deletion, promotion, discovery
2. `containerApplicationDeployment` - AKS deployments
3. `accessControlManagement` - RBAC relationships
4. `workflowOrchestration` - Status tracking with correlation IDs

**Key Patterns**:
- GitHub as Database (metadata in `docs/metadata/*.json`)
- Dual GitHub Apps (infrastructure + code deployment)
- Correlation ID Tracking (format: `cid-{timestamp}-{random}`)
- SPA Navigation (no router, CSS class toggling)
- Workflow Polling (client polls `/api/workflow-status`)

### Technology Stack
- **Frontend**: Vue.js 3 + Pinia (SPA)
- **Backend**: Node.js 18+ + Express.js (unchanged)
- **Authentication**: Dual GitHub Apps
- **Data Storage**: GitHub repository (`docs/metadata/`)
- **CI/CD**: GitHub Actions workflows
- **Infrastructure**: Terraform modules
- **Deployment**: Docker + Kubernetes (AKS)

---

## 3. Site Structure

### Navigation Pattern
Shared header across all pages with:
- Logo + Title: "Self-Service Infrastructure Catalog"
- Navigation links:
  - Home
  - Custom Infrastructure
  - Template Deploy
  - Installed Apps
  - (AKS Deploy - future)

### Page Hierarchy
```
Home (Landing)
├── Custom Infrastructure (Build your own)
├── Template Deploy (Use pre-configured)
├── AKS Deploy (Container deployments)
└── Installed Apps (View/Manage)
```

---

## 4. Sitemap (Existing Pages)

- [x] **Custom Infrastructure** - `custom-infra.html`
  - Module-based provisioning
  - Multi-instance configuration
  - RBAC relationship builder
  - Status: ✅ Design generated (needs iteration)

- [x] **Template Deploy** - `template-deploy.html`
  - Pre-configured templates dropdown
  - Simplified form (fewer fields than custom)
  - Same workflow pattern
  - Status: ✅ Design generated (2026-01-27)

- [x] **AKS Deploy** - `aks-deploy.html`
  - Kubernetes deployment form
  - Namespace, image, replica configuration
  - Status polling with progress
  - Status: ✅ Design generated (2026-01-27, Screen: 57d87bdd9f204258bf55db542e42244d)

- [ ] **Installed Apps** - `installed-apps.html`
  - Data table with search/filter
  - Lifecycle labels (Live/Experimental)
  - Action menu (View, Promote, Label, Delete)
  - Azure Portal integration

- [ ] **Home (Landing)** - `index.html`
  - Hero section
  - 4 action cards pointing to main pages
  - Quick overview of capabilities

---

## 5. Roadmap (Priority Order)

### Iteration 1: Template Deploy Page ✅ COMPLETE
**Priority**: High  
**Reason**: Simpler than custom infra, validates design system consistency

**Status**: ✅ Generated on 2026-01-27  
**Screen ID**: 21b4633eec3f4d6c9a73c05837c74dbc  
**Assets**: docs/screens/template-deploy.html (193 lines), template-deploy.png (52KB)

**Features Delivered**:
- Template dropdown (Aya starter 1, Aya starter 2, Custom)
- Project details form: Name (8 chars), Description, Environment (Select/sand/devsand)
- Metadata fields: Owner, Jira/CR (optional), Project Life (3 days/1 month/3 months)
- Template description preview area
- Module badges summary ("This template includes...")
- Actions: Cancel (secondary gray) + "Generate Template Code" (primary blue)
- Clean card-based layout with 1200px max-width, #f8fafc background
- Follows design system: #2563eb primary, Segoe UI, 6px radius, subtle shadows

**Reference**: `public/index.html` lines 190-250, `CUSTOM-INFRA-FEATURE-INVENTORY.md`

---

### Iteration 2: AKS Deploy Page ⬅️ NEXT
**Priority**: High  
**Reason**: Central management hub, complex table UI

**Requirements**:
- Search bar + Environment filter
- Data table with columns: Project/Env, Version, Description, Owner, Created/Age, Actions
- Lifecycle badges: Live (green check), Experimental (yellow flask)
- Action menu (3-dot dropdown): View, Promote, Label, Add Repo, Delete
- Azure Portal deep linking
- Empty state with "Deploy New Application" button

**Reference**: `public/js/app.js` lines 200-400

---

### Iteration 2: AKS Deploy Page ✅ COMPLETE
**Status**: ✅ Generated on 2026-01-27  
**Screen ID**: 57d87bdd9f204258bf55db542e42244d  
**Assets**:
- `docs/screens/aks-deploy.html` (9.3KB, 9362 bytes)
- `docs/screens/aks-deploy.png` (36KB, 36071 bytes)

**Features Delivered**:
- Kubernetes-focused deployment interface
- 3-card layout: Environment Selection, Application Details, Container Configuration
- Radio group selection: Web Application vs Background Service (with icons and descriptions)
- Kubernetes naming validation patterns (^[a-z0-9]([-a-z0-9]*[a-z0-9])?$)
- Progressive disclosure: Namespace auto-population from app name
- Sand environment limitation callout (info badge)
- Container registry integration (ACR path examples)
- Enterprise SaaS aesthetic: #2563eb primary color, 6px border-radius, Segoe UI font
- Right-aligned action buttons: Cancel (ghost) + Deploy to AKS (primary)

**Design Highlights**:
- Large selectable radio cards for application type (more prominent than standard radio buttons)
- Kubernetes icon (fab fa-kubernetes) in environment card
- Helper text on all fields with validation rules
- Disabled dropdown for sand-only environment (future-ready for multi-env)

**Reference**: `public/index.html` lines 350-450, `routes/api.js` AKS endpoints

---

### Iteration 3: Installed Apps Page ✅ COMPLETE
**Status**: ✅ Generated on 2026-01-27  
**Screen ID**: 2f59940f41fb418281b392a5186fd119  
**Assets**:
- `docs/screens/installed-apps.html` (15KB, 15098 bytes)
- `docs/screens/installed-apps.png` (40KB, 41255 bytes)

**Features Delivered**:
- Comprehensive management dashboard for provisioned infrastructure
- Search bar with real-time filtering + Environment dropdown filter (All, sand, devsand)
- 6-column data table: Project/Environment, Version, Description, Owner, Created/Age, Actions
- Lifecycle badge system: Live (green check-circle), Experimental (yellow flask)
- Three-dot action menu (6 items): View in Azure Portal, Promote to Infra-Live, Label Live/Experiment, Add Code Repo, Delete
- Azure Portal deep linking with subscription ID mapping
- Empty state with icon + "Deploy New Application" CTA button
- Loading state with spinner + "Loading applications..." message
- Project-environment compound display with icons (server icon for environment)
- Professional data table design: zebra striping, hover states, responsive columns
- Enterprise SaaS aesthetic: #2563eb primary color, 6px border-radius, Segoe UI font
- Action menu positioning: right-aligned column with dropdown on click

**Design Highlights**:
- Most complex screen in application: 6-column table with multiple states (loading, empty, populated)
- Visual hierarchy: Project name bold, environment as secondary info with icon
- Badge component: Filled backgrounds (green/yellow) with icons, inline display
- Overflow menu pattern: Three-dot trigger, dropdown with icon+text items, divider before delete
- Responsive table: Maintains readability across breakpoints, prioritized column visibility

**Technical Notes**:
- Largest HTML file (15KB): Complex table structure with badges, menus, multiple states
- Consistent PNG size (40KB): High-quality screenshot showing populated table with sample data
- Azure subscription mapping: Environment-to-subscription-ID lookup for Portal links
- Search + filter combined: Client-side filtering on project name, description, owner

**Reference**: `public/js/app.js` lines 200-400

---

### Iteration 4: Shared Header Component ✅ COMPLETE
**Status**: ✅ Generated 2026-01-27 | Assets Downloaded  
**Screen ID**: `ca4fc5d997cc4c1792bbc333c68e2abb`  
**Session ID**: `12362567639302120990`  
**Assets**:
- `docs/screens/shared-header.html` (6,608 bytes | 6.5 KB)
- `docs/screens/shared-header.png` (16,254 bytes | 15.9 KB)
- **Total**: 22,862 bytes (22.4 KB)

**Features Delivered**:
- **Reusable Navigation Component**: Logo + 5 nav links + user profile dropdown
- **3-Section Layout**:
  - **Left**: Logo (fa-cubes #2563eb) + "InfraProvision" (18px, weight 600)
  - **Center**: Home | Custom Infra* | Templates | AKS Deploy | Installed Apps
  - **Right**: User avatar ("ST") + "Sushil Tiwari" + chevron + dropdown
- **Active State**: #2563eb color + 3px bottom border (Custom Infra shown active)
- **User Dropdown**: Profile | Settings | [divider] | Logout (red #dc2626)
- **Dimensions**: 64px height, sticky position, #ffffff bg, #e2e8f0 border
- **Typography**: Segoe UI, professional SaaS aesthetic
- **Responsive Specs** (in baton, ready for implementation):
  - Desktop (>1024px): Full layout with text + icons
  - Tablet (768-1023px): Icons only with tooltips
  - Mobile (<768px): Hamburger menu + slide-in drawer (280px)
- **Accessibility**: ARIA labels, keyboard nav (Tab/Enter/Escape), focus states

**Technical Details**:
- **Baton**: 361 lines (largest, most comprehensive spec)
- **Generation**: 2560×2048px DESKTOP viewport, PRO_AGENT mode
- **Note**: Retry succeeded after Phase 22 temporary API issue

**Next Reference**: This component will be integrated into all future page iterations (Iterations 5-9) as shared navigation element

---

### Iteration 5: Home Landing Page
**Status**: ⏳ Pending  
**Priority**: Medium  
**Features**: Hero section, 4 feature cards (Custom Infra, Templates, AKS, Apps), quick actions
**Note**: Will reference Shared Header component (Iteration 4, `shared-header.html`)

---

### Iteration 6: Custom Infrastructure Refinement
**Priority**: Low  
**Reason**: Already have initial design, refine based on user feedback

**Tasks**:
- Implement expandable instance configuration panel
- Add RBAC relationship visual display
- Refine module card interactions
- Add micro-animations
- Validate against feature inventory

---

## 6. Creative Freedom (Ideas for Future)

If roadmap is complete, consider these enhancements:

### New Pages
- **RBAC Manager** - Standalone page for visual relationship builder (currently modal)
- **Workflow History** - View all past deployments with correlation IDs
- **Module Catalog** - Detailed view of available modules with docs
- **Settings/Profile** - User preferences, default values

### Component Ideas
- **Status Dashboard** - Real-time view of all running workflows
- **Cost Estimator** - Preview Azure costs before provisioning
- **Deployment Calendar** - Visual timeline of infrastructure changes
- **Resource Graph** - Visual representation of RBAC relationships

### UX Improvements
- **Dark Mode** - Toggle between light/dark themes
- **Keyboard Shortcuts** - Power user features
- **Guided Tour** - First-time user onboarding
- **Templates Gallery** - Browse templates with previews

---

## 7. Design Principles

1. **Minimalism** - Remove unnecessary elements, focus on core actions
2. **Consistency** - Same patterns across all pages
3. **Enterprise-Grade** - Professional, trustworthy appearance
4. **Accessibility** - WCAG 2.1 AA compliance
5. **Responsive** - Mobile-friendly (stack on small screens)
6. **Performance** - Fast load times, optimized assets
7. **Feedback** - Clear loading states, error messages, success confirmations

---

## 8. Notes for Autonomous Builder

- **Always consult `DESIGN.md`** before generating any page
- **Copy design system block** from `DESIGN.md` Section 6 into every Stitch prompt
- **Reference architecture docs** (`docs/Architecture.md`, `Self-Service-Infra.AppArchitect.json`)
- **Preserve functionality** - Use `CUSTOM-INFRA-FEATURE-INVENTORY.md` as reference for required features
- **Update this file** after completing each iteration (mark [x] in sitemap, remove from roadmap)
- **Test workflow integration** - Ensure forms connect to correct API endpoints
- **Correlation ID tracking** - Include in all workflow-related pages

---

## Iteration 5: Home Landing Page ✅ COMPLETE

**Date**: January 20, 2025  
**Screen ID**: 0f355f465a1346ad88e76359081f1c74  
**Session ID**: 1448360873284369217 (NEW session)  
**Status**: ✅ COMPLETE (6/6 steps)

### Design Overview
Modern, minimalistic landing page serving as the welcoming entry point to Self Service Catalog platform. Features hero section with clear value proposition, 4 feature cards highlighting core capabilities, and quick statistics section.

### Screen Specifications
- **Dimensions**: 2560×5598px (DESKTOP viewport)
- **Agent Type**: PRO_AGENT (professional quality)
- **Theme**: LIGHT mode, INTER font, #2463eb primary, 8px radius

### Layout Components

**Header** (Shared, 64px, sticky):
- Logo: fas fa-cubes (#2563eb) + **"Self Service Catalog"** text ✅ CORRECT BRANDING
- Navigation: Home (active, blue underline) | Custom Infra | Templates | AKS Deploy | Installed Apps
- User: Avatar "ST" + "Sushil Tiwari"

**Hero Section** (Full width, gradient background):
- **Title**: **"Self Service Catalog"** (2.5rem, bold, #1e293b) ✅ CORRECT BRANDING
- **Subtitle**: "Provision, Deploy, and Manage Azure Infrastructure" (1.25rem, #64748b)
- **Description**: Platform explanation with correct branding (1rem, #64748b, 700px max-width)
- **CTA Button**: "Get Started" (#2563eb, white text, → /custom-infrastructure)

**Feature Cards** (2×2 grid, 1.5rem gaps):
1. **Custom Infrastructure**: fas fa-tools (48px, #2563eb) | "Start Building →" | Link: /custom-infrastructure
2. **Deploy Templates**: fas fa-copy (48px, #2563eb) | "Browse Templates →" | Link: /template-deploy
3. **Deploy to AKS**: fab fa-kubernetes (48px, #2563eb) | "Deploy to AKS →" | Link: /aks-deploy
4. **Manage Apps**: fas fa-server (48px, #2563eb) | "View Applications →" | Link: /installed-apps

**Quick Stats** (3 columns):
- "50+" Azure Modules (3rem, #2563eb, bold)
- "120+" Active Applications (3rem, #2563eb, bold)
- "3" Environments: DevSand, Sand, Prod (3rem, #2563eb, bold)

### Design System Applied
- **Colors**: #2563eb (primary), #64748b (secondary), #1e293b (text), #f8fafc (background)
- **Typography**: Segoe UI requested (INTER font applied by Stitch)
- **Components**: 8px radius, subtle shadows, hover scale(1.02) with transition
- **Icons**: Font Awesome 6 - fa-cubes, fa-tools, fa-copy, fab fa-kubernetes, fa-server

### Responsive Behavior
- **Desktop (>1024px)**: 2×2 card grid, full stats row, 1200px max width
- **Mobile (<768px)**: 1 column cards, stacked stats

### Assets Generated
- **HTML**: home-landing.html (14,946 bytes)
  - File ID: adc2a4f8f09d4b7e8bf716f4b3f2982a
  - Location: `docs/screens/home-landing.html`
- **PNG**: home-landing.png (28,547 bytes)
  - File ID: c358005c86d34b6daebbcb38db81dd90
  - Location: `docs/screens/home-landing.png`

### Branding Correction ✅
**IMPORTANT**: This iteration uses correct branding **"Self Service Catalog"** throughout all text, replacing previous incorrect "InfraProvision" name. Verified in:
- Header logo text: ✅ "Self Service Catalog"
- Hero title: ✅ "Self Service Catalog"
- Screen title: ✅ "Self Service Catalog Home Landing Page"
- HTML content: ✅ Verified via grep (no "InfraProvision" found)

### Navigation & CTAs
- **Get Started** → /custom-infrastructure
- **Start Building →** → /custom-infrastructure
- **Browse Templates →** → /template-deploy
- **Deploy to AKS →** → /aks-deploy
- **View Applications →** → /installed-apps

### Iteration Summary
Home Landing Page serves as professional, welcoming entry point with clear value proposition. Successfully implements corrected "Self Service Catalog" branding across all UI elements. Features modern SaaS aesthetic with 4 capability cards, quick stats, and prominent CTA. Design system consistently applied: #2563eb primary blue, 8px radius, Enterprise typography, responsive grid.

**Status**: ✅ COMPLETE (Generation, HTML download, PNG download, documentation - all steps finished)

---

## Iteration 6: Shared Header v2 (Branding Fix) ✅ COMPLETE

**Date**: January 27, 2026  
**Screen ID**: 0e2184bd2b8041deaa74c180b72b1aff  
**Session ID**: 1526030978127476805  
**Status**: ✅ COMPLETE - Branding corrected from v1

### Purpose
Fix branding error in original Shared Header (Iteration 4). Replaces "InfraProvision" with correct "Self Service Catalog" branding.

### Assets
- **HTML**: shared-header-v2.html (7.6 KB)
- **PNG**: shared-header-v2.png (8.4 KB)
- **Verification**: ✅ 2 "Self Service Catalog" | ✅ 0 "InfraProvision"

### v1 vs v2 Comparison
| Item | v1 (Iteration 4) | v2 (Iteration 6) |
|------|------------------|------------------|
| Screen ID | ca4fc5d997cc4c1792bbc333c68e2abb | 0e2184bd2b8041deaa74c180b72b1aff |
| Title | ❌ "InfraProvision" | ✅ "Self Service Catalog" |
| Brand Text | ❌ "InfraProvision" | ✅ "Self Service Catalog" |
| File Size | 6.5 KB | 7.6 KB |
| Status | Deprecated | ✅ Current (use this) |

**Note**: v1 deprecated, use v2 for all future implementations

---

**Current Status**: Iteration 6 complete (Shared Header v2 branding fix). Next: Template Deploy v2 branding fix  
**Next Task**: Continue to Iteration 7 - Template Deploy v2
