# 🎯 Coding Agent Mission Brief

**Project**: Vue.js v2 Design System Implementation  
**Start Date**: January 27, 2026  
**Estimated Duration**: 20-30 hours (2.5-4 days)  
**Priority**: HIGH - Critical path blocking other features

---

## 📋 Mission Objective

Implement the v2 design system for Self Service Infrastructure Catalog by migrating existing Vue.js components to match finalized designs. All backend APIs are operational (28+ endpoints). **NO stretch goals** - everything can be implemented immediately.

---

## 🎁 Complete Handoff Package Location

```
/Users/Sushil.Tiwari/self-service-infra/docs/vue-handoff/
```

### 📚 Read These Files in Order:

1. **README.md** - Start here for complete overview (255 lines)
2. **1-mvp-scope.md** - Feature inventory & priorities (~8,500 chars)
3. **2-api-integration-guide.md** - All 28+ API endpoints documented (~28,000 chars)
4. **3-component-specifications/** - Detailed specs for SharedHeader & StatusModal
5. **4-design-system.md** - Complete design tokens & patterns (~19,000 chars)
6. **5-implementation-checklist.md** - Phase-by-phase task breakdown (~23,500 chars)

### 🎨 Design References:

```
/Users/Sushil.Tiwari/self-service-infra/docs/screens/*.html
```

11 HTML screens with complete v2 designs (reference implementations)

---

## 🚦 Critical Path (Must Complete First)

### Phase 1: Shared Components (7-10 hours)
```
Priority: 🔴 CRITICAL - Blocks all pages

1. Create SharedHeader.vue (4-6 hours)
   - Spec: 3-component-specifications/SharedHeader.md
   - Design: docs/screens/01-landing-page.html (header section)
   - Features: Logo, navigation, dark mode toggle, user menu
   - Test: Dark mode switching, responsive behavior

2. Create StatusModal.vue (3-4 hours)
   - Spec: 3-component-specifications/StatusModal.md
   - States: Success, In Progress, Error
   - Features: Progress bar, correlation ID display, PR links
   - Test: All 3 states, workflow polling integration
```

### Phase 2: Page Updates (10-15 hours)
```
Priority: 🟡 HIGH - Requires Phase 1 complete

3. Update CustomInfrastructurePage.vue (2-3 hours)
   - Design: docs/screens/02-custom-infrastructure.html
   - API: POST /api/custom
   - Apply v2 styling, integrate SharedHeader, use StatusModal

4. Update TemplateDeployPage.vue (2-3 hours)
   - Design: docs/screens/03-template-deploy.html
   - API: POST /api/template
   - Apply v2 styling, integrate SharedHeader, use StatusModal

5. Update AKSDeployPage.vue (2-3 hours)
   - Design: docs/screens/06-aks-deploy.html
   - API: POST /api/aks-deploy
   - Apply v2 styling, integrate SharedHeader, use StatusModal

6. Update InstalledAppsPage.vue (2-3 hours)
   - Design: docs/screens/04-installed-apps.html
   - API: GET /api/installed-apps
   - Apply v2 styling, integrate SharedHeader

7. Update HomePage.vue (2-3 hours)
   - Design: docs/screens/01-landing-page.html
   - API: GET /api/apps
   - Apply v2 styling, integrate SharedHeader
```

### Phase 3: Testing & Polish (3-5 hours)
```
Priority: 🟢 MEDIUM - Final validation

8. Test dark mode across all components
9. Verify responsive behavior (mobile, tablet, desktop)
10. Check branding consistency (logo, colors, typography)
11. Run accessibility audit (ARIA labels, keyboard nav)
```

---

## ✅ Success Criteria

**Component-Level**:
- [ ] SharedHeader matches design pixel-perfect
- [ ] StatusModal has all 3 states working
- [ ] Dark mode toggle works globally
- [ ] All pages use consistent v2 styling

**Technical Requirements**:
- [ ] TypeScript strict mode (no `any` types)
- [ ] Composition API with `<script setup>`
- [ ] Test coverage: Components 80%+, Composables 90%+
- [ ] All API integrations use existing endpoints (no backend changes)

**User Experience**:
- [ ] Dark/light mode persists across page refreshes
- [ ] Responsive design works on all screen sizes
- [ ] Loading states show during API calls
- [ ] Error states display helpful messages

**Performance**:
- [ ] Page load < 2 seconds
- [ ] API response handling < 500ms
- [ ] No console errors or warnings

---

## 🛠️ Development Approach

### TDD Workflow (Required):
```
1. Read component spec (folder 3)
2. Define TypeScript types
3. Write failing tests
4. Implement component (minimum code)
5. Tests pass → Refactor
6. Verify against HTML design
7. Test dark mode
8. Mark task complete in checklist
```

### Tech Stack:
- **Framework**: Vue.js 3 (Composition API)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 3.x
- **State**: Pinia stores (navigation, infrastructure, workflow)
- **Testing**: Vitest + @vue/test-utils
- **Icons**: Material Symbols Outlined

### Project Structure:
```
src/
├── components/
│   ├── common/
│   │   ├── SharedHeader.vue (🔴 CREATE)
│   │   └── ... (existing)
│   └── modals/
│       └── StatusModal.vue (🔴 CREATE)
├── views/
│   ├── CustomInfrastructurePage.vue (🟡 UPDATE)
│   ├── TemplateDeployPage.vue (🟡 UPDATE)
│   ├── AKSDeployPage.vue (🟡 UPDATE)
│   ├── InstalledAppsPage.vue (🟡 UPDATE)
│   └── HomePage.vue (🟡 UPDATE)
├── types/
│   └── infrastructure.types.ts (existing)
└── composables/
    ├── useWorkflowPolling.ts (existing)
    └── useModal.ts (existing)
```

---

## 📊 Progress Tracking

Use **5-implementation-checklist.md** to track progress:
- Mark tasks ✅ when complete
- Note any blockers or questions
- Update time estimates if needed

---

## 🆘 Support & References

### Design Questions:
- Review HTML screens: `docs/screens/*.html`
- Check design system: `4-design-system.md`
- Component specs: `3-component-specifications/`

### API Questions:
- Complete endpoint docs: `2-api-integration-guide.md`
- Backend code: `/routes/api.js` (28+ endpoints)
- Test endpoints: `npm run test:api`

### Technical Questions:
- Architecture: `/docs/Architecture.md`
- Existing patterns: Review `srcV2/views/*.vue`
- Vue.js mode: Follow Composition API patterns

---

## 🎬 Getting Started Command

```bash
cd /Users/Sushil.Tiwari/self-service-infra

# 1. Review handoff package
ls -la docs/vue-handoff/
cat docs/vue-handoff/README.md

# 2. Review design screens
open docs/screens/*.html

# 3. Check existing structure
ls -la srcV2/views/
ls -la srcV2/components/

# 4. Start development
npm run dev

# 5. Run tests
npm run test
```

---

## 📝 Daily Progress Report Template

```markdown
## Day [X] Progress Report

**Date**: [Date]
**Hours Worked**: [Hours]

### ✅ Completed:
- [ ] Task name (estimated: Xh, actual: Yh)

### 🚧 In Progress:
- [ ] Task name (X% complete)

### ⏳ Blocked:
- [ ] Issue description + needed resolution

### 📊 Overall Progress:
- Phase 1: [X/2 tasks] ([X]%)
- Phase 2: [X/5 tasks] ([X]%)
- Phase 3: [X/4 tasks] ([X]%)

**Next Session**: [Next task to work on]
```

---

## 🎯 Final Deliverable

When complete, the v2 design system should be:
- ✅ Pixel-perfect match to HTML designs
- ✅ Fully functional with all 28+ API endpoints
- ✅ Dark mode working across all pages
- ✅ Responsive on all screen sizes
- ✅ Test coverage 80%+ for components
- ✅ No console errors or TypeScript warnings
- ✅ Production-ready for deployment

---

**Ready to start?** Begin with `docs/vue-handoff/README.md` then create `SharedHeader.vue`

**Questions during implementation?** Reference the handoff docs - they contain everything needed.

**Estimated completion**: 2.5-4 developer days of focused work.

🚀 **Let's build this!**
