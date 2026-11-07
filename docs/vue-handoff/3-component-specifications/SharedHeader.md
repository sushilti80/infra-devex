# SharedHeader.vue Specification

**Priority**: 🔴 CRITICAL  
**Status**: 🔴 NEW (Must be created from scratch)  
**Effort**: 4-6 hours  
**Dependencies**: None (foundation component)

---

## Overview

The **SharedHeader** is a persistent navigation component that appears on every page of the application. It provides branding, navigation links, and future authentication UI.

**Design Reference**: All 11 HTML screens in `/docs/vue-handoff/assets/designs/`

---

## Visual Appearance

### Light Mode
```
┌─────────────────────────────────────────────────────────────────┐
│  🧊 Self Service Catalog          Home  Custom  Templates  Apps │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Dark Mode
```
┌─────────────────────────────────────────────────────────────────┐
│  🧊 Self Service Catalog          Home  Custom  Templates  Apps │
│  [Dark background with light text]                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component API

### Props
```typescript
interface Props {
  currentPage?: string;  // Current active page (for highlighting)
}

// Usage:
<SharedHeader current-page="home" />
```

### Emits
```typescript
interface Emits {
  (e: 'navigate', page: string): void;
}

// Usage:
@navigate="handleNavigation"
```

### Slots
```typescript
// No slots needed in v2
// Future: slot for user avatar/menu
```

---

## Component Structure

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

interface Props {
  currentPage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentPage: 'home'
});

const emit = defineEmits<{
  navigate: [page: string];
}>();

const router = useRouter();

// Navigation items with icons
const navItems = [
  { id: 'home', label: 'Home', icon: 'home', route: '/' },
  { id: 'custom', label: 'Custom Infrastructure', icon: 'tools', route: '/custom' },
  { id: 'template', label: 'Templates', icon: 'copy', route: '/templates' },
  { id: 'apps', label: 'Installed Apps', icon: 'server', route: '/apps' }
];

// Check if nav item is active
const isActive = (itemId: string): boolean => {
  return props.currentPage === itemId;
};

// Handle navigation
const handleNavClick = (item: typeof navItems[0]) => {
  emit('navigate', item.id);
  router.push(item.route);
};
</script>

<template>
  <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
    <div class="container mx-auto px-6">
      <div class="flex items-center justify-between h-16">
        <!-- Logo & Branding -->
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
            <span class="text-white text-lg">🧊</span>
          </div>
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Self Service Catalog
          </h1>
        </div>

        <!-- Navigation Links -->
        <nav class="flex items-center space-x-1">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            :class="[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive(item.id)
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            ]"
            @click="handleNavClick(item)"
          >
            <i :class="`fas fa-${item.icon} mr-2`"></i>
            {{ item.label }}
          </button>
        </nav>

        <!-- Future: User Menu (Entra ID) -->
        <!-- 
        <div class="flex items-center space-x-3">
          <button class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <i class="fas fa-bell text-gray-600 dark:text-gray-300"></i>
          </button>
          <div class="flex items-center space-x-2 cursor-pointer">
            <img src="/avatar.png" class="w-8 h-8 rounded-full" />
            <span class="text-sm font-medium">John Doe</span>
          </div>
        </div>
        -->
      </div>
    </div>
  </header>
</template>
```

---

## Styling Details

### Colors (CSS Variables)
```css
/* Light Mode */
--header-bg: #ffffff;
--header-border: #e5e7eb;
--header-text: #111827;
--nav-hover-bg: #f9fafb;
--nav-active-bg: #eff6ff;
--nav-active-text: #2563eb;

/* Dark Mode */
--header-bg-dark: #1f2937;
--header-border-dark: #374151;
--header-text-dark: #ffffff;
--nav-hover-bg-dark: rgba(55, 65, 81, 0.5);
--nav-active-bg-dark: rgba(37, 99, 235, 0.3);
--nav-active-text-dark: #60a5fa;
```

### Typography
- **Logo Text**: `text-xl font-semibold` (20px, 600 weight)
- **Nav Links**: `text-sm font-medium` (14px, 500 weight)

### Spacing
- **Container Padding**: `px-6` (24px horizontal)
- **Header Height**: `h-16` (64px)
- **Nav Item Spacing**: `space-x-1` (4px between items)
- **Nav Button Padding**: `px-4 py-2` (16px horizontal, 8px vertical)

### Icons
- **Font Awesome 6**: Use `fas fa-{icon}` classes
- **Icon Size**: Default (inherits font-size)
- **Icon Margin**: `mr-2` (8px right margin)

---

## Responsive Behavior

### Desktop (≥1024px)
- Full navigation visible
- Logo + text visible
- All nav items displayed

### Tablet (768px - 1023px)
- Full navigation visible
- Logo + text visible
- Nav items may wrap if too many

### Mobile (<768px)
```vue
<!-- Mobile navigation (future enhancement) -->
<template>
  <header class="bg-white dark:bg-gray-800 border-b">
    <div class="container mx-auto px-4">
      <div class="flex items-center justify-between h-16">
        <!-- Logo -->
        <div class="flex items-center space-x-2">
          <div class="w-8 h-8 bg-blue-500 rounded">🧊</div>
          <h1 class="text-lg font-semibold">Self Service Catalog</h1>
        </div>
        
        <!-- Mobile Menu Button -->
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="toggleMobileMenu"
        >
          <i class="fas fa-bars"></i>
        </button>
      </div>
      
      <!-- Mobile Menu (dropdown) -->
      <div v-if="mobileMenuOpen" class="pb-4 pt-2 space-y-1">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="w-full text-left px-4 py-2 rounded-lg"
          @click="handleNavClick(item)"
        >
          <i :class="`fas fa-${item.icon} mr-2`"></i>
          {{ item.label }}
        </button>
      </div>
    </div>
  </header>
</template>
```

**Note**: Mobile menu is **NOT IN V2 SCOPE** (Nice to Have). Desktop/tablet layout is sufficient for MVP.

---

## Accessibility

### Keyboard Navigation
```vue
<button
  type="button"
  @click="handleNavClick(item)"
  @keydown.enter="handleNavClick(item)"
  @keydown.space.prevent="handleNavClick(item)"
>
  {{ item.label }}
</button>
```

### ARIA Attributes
```vue
<nav aria-label="Primary navigation">
  <button
    :aria-current="isActive(item.id) ? 'page' : undefined"
    :aria-label="`Navigate to ${item.label}`"
  >
    {{ item.label }}
  </button>
</nav>
```

### Screen Reader Support
- Logo text: "Self Service Catalog"
- Nav buttons: Full text labels (not just icons)
- Active state: `aria-current="page"`

---

## State Management

### No Global State Needed
```vue
<script setup lang="ts">
// SharedHeader is stateless
// Receives currentPage as prop
// Emits navigate event

// Parent component manages routing
</script>
```

### Integration with Vue Router
```vue
<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

// Compute current page from route
const currentPage = computed(() => {
  const path = route.path;
  if (path === '/') return 'home';
  if (path.startsWith('/custom')) return 'custom';
  if (path.startsWith('/template')) return 'template';
  if (path.startsWith('/apps')) return 'apps';
  return 'home';
});
</script>

<template>
  <SharedHeader :current-page="currentPage" @navigate="handleNavigation" />
</template>
```

---

## Testing Requirements

### Unit Tests (Vitest)
```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SharedHeader from './SharedHeader.vue';

describe('SharedHeader.vue', () => {
  it('renders logo and title', () => {
    const wrapper = mount(SharedHeader);
    expect(wrapper.text()).toContain('Self Service Catalog');
    expect(wrapper.find('.bg-blue-500').exists()).toBe(true);
  });

  it('renders all navigation items', () => {
    const wrapper = mount(SharedHeader);
    expect(wrapper.findAll('button').length).toBe(4); // 4 nav items
    expect(wrapper.text()).toContain('Home');
    expect(wrapper.text()).toContain('Custom Infrastructure');
    expect(wrapper.text()).toContain('Templates');
    expect(wrapper.text()).toContain('Installed Apps');
  });

  it('highlights active nav item', () => {
    const wrapper = mount(SharedHeader, {
      props: { currentPage: 'custom' }
    });
    
    const buttons = wrapper.findAll('button');
    const customButton = buttons.find(btn => btn.text().includes('Custom Infrastructure'));
    
    expect(customButton?.classes()).toContain('bg-blue-50');
    expect(customButton?.classes()).toContain('text-blue-600');
  });

  it('emits navigate event on click', async () => {
    const wrapper = mount(SharedHeader);
    
    const homeButton = wrapper.findAll('button')[0];
    await homeButton.trigger('click');
    
    expect(wrapper.emitted('navigate')).toBeTruthy();
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['home']);
  });

  it('supports keyboard navigation', async () => {
    const wrapper = mount(SharedHeader);
    
    const homeButton = wrapper.findAll('button')[0];
    await homeButton.trigger('keydown.enter');
    
    expect(wrapper.emitted('navigate')).toBeTruthy();
  });

  it('applies dark mode classes', () => {
    const wrapper = mount(SharedHeader);
    
    const header = wrapper.find('header');
    expect(header.classes()).toContain('dark:bg-gray-800');
    expect(header.classes()).toContain('dark:border-gray-700');
  });
});
```

### Visual Regression Tests
```typescript
// Use Playwright or Cypress for visual testing
it('matches screenshot in light mode', async () => {
  await page.goto('/');
  await expect(page.locator('header')).toHaveScreenshot('header-light.png');
});

it('matches screenshot in dark mode', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('header')).toHaveScreenshot('header-dark.png');
});
```

---

## Integration Examples

### Example 1: App.vue
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router';
import SharedHeader from '@/components/common/SharedHeader.vue';

const router = useRouter();

function handleNavigation(page: string) {
  // Optional: Additional logic before navigation
  console.log('Navigating to:', page);
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <SharedHeader @navigate="handleNavigation" />
    
    <main class="container mx-auto px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
```

### Example 2: With Custom Active Detection
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SharedHeader from '@/components/common/SharedHeader.vue';

const route = useRoute();

const currentPage = computed(() => {
  // Map route paths to page IDs
  const pathMap: Record<string, string> = {
    '/': 'home',
    '/custom': 'custom',
    '/template': 'template',
    '/apps': 'apps'
  };
  
  return pathMap[route.path] || 'home';
});
</script>

<template>
  <SharedHeader :current-page="currentPage" />
</template>
```

---

## Implementation Checklist

### Phase 1: Basic Structure (1-2 hours)
- [ ] Create `SharedHeader.vue` file
- [ ] Add TypeScript props/emits interfaces
- [ ] Implement logo with icon + text
- [ ] Add navigation items array
- [ ] Implement basic click handlers

### Phase 2: Styling (1-2 hours)
- [ ] Apply Tailwind CSS classes
- [ ] Add light mode colors
- [ ] Add dark mode colors
- [ ] Implement active state styling
- [ ] Add hover states

### Phase 3: Functionality (1 hour)
- [ ] Integrate with Vue Router
- [ ] Implement active page detection
- [ ] Add navigation emitter
- [ ] Test routing integration

### Phase 4: Testing (1 hour)
- [ ] Write unit tests (6+ tests)
- [ ] Test accessibility
- [ ] Test keyboard navigation
- [ ] Test dark mode toggle
- [ ] Visual regression tests

---

## Acceptance Criteria

### Functional
- ✅ Logo + text visible on all pages
- ✅ All 4 navigation links visible
- ✅ Active page highlighted
- ✅ Click navigation works
- ✅ Vue Router integration works
- ✅ Navigation emits correct event

### Visual
- ✅ Matches design system colors
- ✅ Dark mode works
- ✅ Hover states work
- ✅ Active states work
- ✅ Typography matches spec

### Accessibility
- ✅ Keyboard navigation works
- ✅ Screen reader friendly
- ✅ ARIA attributes present
- ✅ Focus indicators visible

### Performance
- ✅ Renders in <50ms
- ✅ No layout shifts
- ✅ Smooth transitions

---

## Future Enhancements (Not in v2)

1. **User Menu** (Entra ID integration)
   - User avatar
   - Dropdown menu
   - Logout button

2. **Notifications**
   - Bell icon with badge
   - Notification dropdown

3. **Search**
   - Global search bar
   - Command palette (⌘K)

4. **Mobile Menu**
   - Hamburger icon
   - Slide-out drawer
   - Touch gestures

5. **Breadcrumbs**
   - Show page hierarchy
   - Navigation trail

---

**Implementation Time**: 4-6 hours  
**Testing Time**: 1 hour  
**Total**: 5-7 hours  
**Next Component**: StatusModal.vue
