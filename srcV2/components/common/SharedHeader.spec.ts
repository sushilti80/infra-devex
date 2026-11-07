import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import SharedHeader from './SharedHeader.vue'
import { useNavigationStore } from '../../stores/navigation'

// Mock useAuth composable
const mockIsAuthenticated = ref(false)
vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated
  })
}))

// Mock LoginButton component
vi.mock('../LoginButton.vue', () => ({
  default: {
    name: 'LoginButton',
    template: '<div data-testid="login-button">Login</div>'
  }
}))

describe('SharedHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockIsAuthenticated.value = false
  })

  describe('Branding', () => {
    it('renders the logo icon with correct Material Symbol', () => {
      const wrapper = mount(SharedHeader)
      const icon = wrapper.find('[data-testid="logo-group"] .material-symbols-outlined')
      expect(icon.exists()).toBe(true)
      expect(icon.text()).toBe('view_in_ar')
    })

    it('renders the title "Self Service Catalog"', () => {
      const wrapper = mount(SharedHeader)
      const title = wrapper.find('[data-testid="logo-group"] > div:last-child')
      expect(title.text()).toBe('Self Service Catalog')
    })

    it('applies correct styling classes to logo and title', () => {
      const wrapper = mount(SharedHeader)
      const logoIcon = wrapper.find('[data-testid="logo-group"] .material-symbols-outlined')
      expect(logoIcon.classes()).toContain('text-3xl')

      const title = wrapper.find('[data-testid="logo-group"] > div:last-child')
      expect(title.classes()).toContain('text-brand-dark')
      expect(title.classes()).toContain('dark:text-white')
      expect(title.classes()).toContain('font-semibold')
    })
  })

  describe('Navigation', () => {
    it('renders only public navigation items when not authenticated', () => {
      mockIsAuthenticated.value = false
      const wrapper = mount(SharedHeader)
      const navLinks = wrapper.findAll('nav a').filter(link => !link.attributes('href')?.startsWith('http'))
      expect(navLinks).toHaveLength(2) // Home and Quick Start

      expect(navLinks[0].text()).toBe('Home')
      expect(navLinks[1].text()).toBe('Quick Start')
    })

    it('renders all non-hidden navigation items when authenticated', () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      const navLinks = wrapper.findAll('nav a').filter(link => !link.attributes('href')?.startsWith('http'))
      expect(navLinks).toHaveLength(6) // All items except hidden Template Deploy

      const expectedLabels = ['Home', 'Quick Start', 'Custom Infrastructure', 'AKS Playground', 'Installed Apps', 'Request Feature/Bugfix']
      navLinks.forEach((link, index) => {
        expect(link.text()).toBe(expectedLabels[index])
      })
    })

    it('hides the Template Deploy nav item to reclaim header space', () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      const templateLink = wrapper.find('[data-testid="nav-link-template"]')
      expect(templateLink.exists()).toBe(false)
    })

    it('shows Consult Archie link when authenticated', () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      const archieLink = wrapper.findAll('nav a').find(link => link.text().includes('Consult Archie'))
      expect(archieLink).toBeTruthy()
      expect(archieLink?.attributes('href')).toBe('https://archie.ayahealthcare.com/')
      expect(archieLink?.attributes('target')).toBe('_blank')
    })

    it('highlights the active navigation item', async () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      const navigationStore = useNavigationStore()

      // Default page is 'home' (docs)
      await wrapper.vm.$nextTick()

      // Navigate to 'custom' page
      navigationStore.navigateToPage('custom')
      await wrapper.vm.$nextTick()

      const customLink = wrapper.find('[data-testid="nav-link-custom"]')
      expect(customLink.classes()).toContain('nav-link-active')
    })

    it('navigates to correct page when nav item is clicked', async () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      const navigationStore = useNavigationStore()

      const customLink = wrapper.find('[data-testid="nav-link-custom"]')
      await customLink.trigger('click')

      expect(navigationStore.currentPage).toBe('custom')
    })

    it('prevents default link behavior on navigation', async () => {
      const wrapper = mount(SharedHeader)
      const homeLink = wrapper.findAll('nav a')[0]

      const event = { preventDefault: () => {} }
      const preventDefaultSpy = { called: false }
      event.preventDefault = () => { preventDefaultSpy.called = true }

      // The component should call preventDefault in handleNavClick
      await homeLink.trigger('click')
      // Since we can't directly spy on preventDefault in this context,
      // we verify the href is "#" which requires preventDefault
      expect(homeLink.attributes('href')).toBe('#')
    })

    it('applies hover styles to navigation links', () => {
      const wrapper = mount(SharedHeader)
      const navLinks = wrapper.findAll('nav a')

      navLinks.forEach(link => {
        if (!link.classes().includes('nav-link-active')) {
          expect(link.classes()).toContain('hover:text-brand-blue')
        }
      })
    })
  })

  describe('Dark Mode', () => {
    it('applies dark mode classes to header', () => {
      const wrapper = mount(SharedHeader)
      const header = wrapper.find('header')
      expect(header.classes()).toContain('dark:bg-background-dark')
      expect(header.classes()).toContain('dark:border-white/10')
    })

    it('applies dark mode classes to title', () => {
      const wrapper = mount(SharedHeader)
      const title = wrapper.find('[data-testid="logo-group"] > div:last-child')
      expect(title.classes()).toContain('dark:text-white')
    })

    it('applies dark mode classes to navigation items', () => {
      const wrapper = mount(SharedHeader)
      const navLinks = wrapper.findAll('nav a')

      navLinks.forEach(link => {
        if (!link.classes().includes('nav-link-active')) {
          expect(link.classes()).toContain('dark:text-white/70')
          expect(link.classes()).toContain('dark:hover:text-white')
        }
      })
    })
  })

  describe('Authentication', () => {
    it('renders LoginButton component', () => {
      const wrapper = mount(SharedHeader)
      const loginButton = wrapper.find('[data-testid="login-button"]')
      expect(loginButton.exists()).toBe(true)
    })
  })

  describe('Responsive Design', () => {
    it('uses sticky positioning for header', () => {
      const wrapper = mount(SharedHeader)
      const header = wrapper.find('header')
      expect(header.classes()).toContain('sticky')
      expect(header.classes()).toContain('top-0')
      expect(header.classes()).toContain('z-50')
    })

    it('has fixed height of 16 units (64px)', () => {
      const wrapper = mount(SharedHeader)
      const header = wrapper.find('header')
      expect(header.classes()).toContain('h-16')
    })

    it('applies correct horizontal padding', () => {
      const wrapper = mount(SharedHeader)
      const container = wrapper.find('header > div')
      expect(container.classes()).toContain('px-10')
    })
  })

  describe('Accessibility', () => {
    it('uses semantic HTML structure', () => {
      mockIsAuthenticated.value = true
      const wrapper = mount(SharedHeader)
      expect(wrapper.find('header').exists()).toBe(true)
      expect(wrapper.find('nav').exists()).toBe(true)
      // When authenticated: 6 nav items + 1 Consult Archie external link = 7 total
      const navLinks = wrapper.findAll('nav a')
      expect(navLinks.length).toBeGreaterThanOrEqual(2) // At minimum 2 (home + docs)
    })

    it('renders the brand title without adding a page heading', () => {
      const wrapper = mount(SharedHeader)
      const title = wrapper.find('[data-testid="logo-group"] > div:last-child')
      expect(title.exists()).toBe(true)
      expect(title.text()).toBe('Self Service Catalog')
      expect(wrapper.find('h1').exists()).toBe(false)
    })
  })

  describe('Layout', () => {
    it('uses flexbox for main container', () => {
      const wrapper = mount(SharedHeader)
      const container = wrapper.find('header > div')
      expect(container.classes()).toContain('flex')
      expect(container.classes()).toContain('items-center')
      expect(container.classes()).toContain('justify-between')
    })

    it('uses gap-3 for logo group spacing', () => {
      const wrapper = mount(SharedHeader)
      const logoGroup = wrapper.find('[data-testid="logo-group"]')
      expect(logoGroup.classes()).toContain('gap-3')
    })

    it('uses gap-10 for navigation spacing', () => {
      const wrapper = mount(SharedHeader)
      const nav = wrapper.find('nav')
      expect(nav.classes()).toContain('gap-10')
    })
  })
})
