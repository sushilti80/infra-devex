# srcV2 - Design System v2 Implementation

This folder contains the **clean, independent implementation** of the v2 design system for the Self Service Infrastructure Catalog. It is completely separate from the existing `src/` implementation.

## Structure

```
srcV2/
├── components/
│   ├── common/         # Shared components (SharedHeader, etc.)
│   └── modals/         # Modal components (StatusModal, etc.)
├── views/              # Page components
├── stores/             # Pinia state management stores
├── composables/        # Reusable Vue composables
├── types/              # TypeScript type definitions
├── services/           # API services
├── utils/              # Utility functions
└── assets/             # Static assets
```

## Design System

- **Framework:** Vue.js 3 with Composition API (`<script setup>`)
- **Language:** TypeScript (strict mode)
- **CSS:** Tailwind CSS 3.x with custom design tokens
- **State:** Pinia stores
- **Testing:** Vitest + @vue/test-utils
- **Icons:** Material Symbols Outlined (Google Fonts)
- **Font:** Inter (Google Fonts)

## Color Palette

- **Brand Blue:** `#2563eb` (brand-blue)
- **Brand Dark:** `#1e293b` (brand-dark)
- **Background Light:** `#f6f6f8` (background-light)
- **Background Dark:** `#161121` (background-dark)
- **Border:** `#e5e7eb` (brand-border)

## Development Workflow

1. **TDD Approach:** Write tests first, then implement components
2. **Component Structure:** Props → State → Computed → Methods → Lifecycle
3. **Testing:** Aim for 80%+ coverage on components, 90%+ on composables

## Implementation Progress

### Phase 1: Core Components (7-10 hours)
- [x] SharedHeader.vue - Global navigation header
- [ ] StatusModal.vue - Workflow status modal

### Phase 2: Page Components (10-15 hours)
- [ ] CustomInfrastructurePage.vue
- [ ] TemplateDeployPage.vue
- [ ] AKSDeployPage.vue
- [ ] InstalledAppsPage.vue
- [ ] HomePage.vue

### Phase 3: Testing & Polish (3-5 hours)
- [ ] Dark mode verification
- [ ] Responsive testing
- [ ] Accessibility audit
- [ ] Branding consistency check

## Key Differences from src/

This implementation:
- Uses v2 design system (new colors, spacing, typography)
- Material Symbols instead of Font Awesome
- Updated component architecture following latest Vue 3 best practices
- Enhanced TypeScript strict mode
- Comprehensive test coverage from the start
- No legacy code or technical debt

## Documentation

- Full specification: `/docs/vue-handoff/`
- Design system: `/docs/vue-handoff/4-design-system.md`
- Component specs: `/docs/vue-handoff/3-component-specifications/`
- Implementation checklist: `/docs/vue-handoff/5-implementation-checklist.md`
