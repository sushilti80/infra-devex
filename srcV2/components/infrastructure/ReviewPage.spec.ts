import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewPage from './ReviewPage.vue'
import type { ProjectInfo, Module, ResourceInstance, RbacRelationship } from '@v2/types/infrastructure.types'

// Mock project info
const mockProjectInfo: ProjectInfo = {
  projectName: 'test-project',
  description: 'Test project description',
  environment: 'sand',
  owner: 'test.user@example.com',
  lifecycle: 'experimental',
  projectAge: 3,
  approvalNumber: 'CR-12345'
}

// Mock modules
const mockModules: Module[] = [
  {
    name: 'AppService',
    category: 'compute',
    description: 'Azure App Service'
  },
  {
    name: 'StorageAccount',
    category: 'storage',
    description: 'Azure Storage Account'
  }
]

// Mock resource instances
const mockInstances: ResourceInstance[] = [
  {
    id: '1',
    name: 'test-appservice-prod',
    moduleType: 'AppService'
  },
  {
    id: '2',
    name: 'test-storage-prod',
    moduleType: 'StorageAccount'
  }
]

// Mock RBAC relationships
const mockRbacRelationships: RbacRelationship[] = [
  {
    id: '1',
    sourceId: '1',
    sourceName: 'test-appservice-prod',
    targetId: '2',
    targetName: 'test-storage-prod',
    role: 'Contributor',
    description: 'App Service needs access to Storage Account'
  }
]

describe('ReviewPage', () => {
  describe('Component Structure', () => {
    it('should render without errors', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.exists()).toBe(true)
    })

    it('should display review header', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.find('.review-header').exists()).toBe(true)
      expect(wrapper.find('.review-header h2').text()).toBe('Review Configuration')
    })

    it('should display all four review sections', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const sections = wrapper.findAll('.review-section')
      expect(sections.length).toBe(4) // Project Info, Modules, Instances, RBAC
    })
  })

  describe('Project Information Section', () => {
    it('should display project name', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('test-project')
    })

    it('should display project description', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('Test project description')
    })

    it('should display environment badge', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('sand')
      expect(wrapper.find('.badge-environment').exists()).toBe(true)
    })

    it('should display owner', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('test.user@example.com')
    })

    it('should display lifecycle badge', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('experimental')
      expect(wrapper.find('.badge-lifecycle').exists()).toBe(true)
    })

    it('should display project age', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('3 months')
    })

    it('should display approval number', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('CR-12345')
    })

    it('should display N/A when approval number is empty', () => {
      const infoWithoutApproval: ProjectInfo = {
        ...mockProjectInfo,
        approvalNumber: ''
      }
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: infoWithoutApproval,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('N/A')
    })
  })

  describe('Selected Modules Section', () => {
    it('should display module cards when modules are selected', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      const moduleCards = wrapper.findAll('.module-card')
      expect(moduleCards.length).toBe(2)
    })

    it('should display module names', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('AppService')
      expect(wrapper.text()).toContain('StorageAccount')
    })

    it('should display module categories', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('compute')
      expect(wrapper.text()).toContain('storage')
    })

    it('should show empty state when no modules selected', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      const sections = wrapper.findAll('.review-section')
      const modulesSection = sections[1] // Second section is modules
      expect(modulesSection.find('.empty-state').exists()).toBe(true)
      expect(modulesSection.text()).toContain('No modules selected')
    })
  })

  describe('Resource Instances Section', () => {
    it('should display instance items when instances are configured', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      const instanceItems = wrapper.findAll('.instance-item')
      expect(instanceItems.length).toBe(2)
    })

    it('should display instance names', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('test-appservice-prod')
      expect(wrapper.text()).toContain('test-storage-prod')
    })

    it('should display instance module types', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.text()).toContain('Type: AppService')
      expect(wrapper.text()).toContain('Type: StorageAccount')
    })

    it('should display total instances count', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      const sections = wrapper.findAll('.review-section')
      const instancesSection = sections[2] // Third section is instances
      expect(instancesSection.text()).toContain('Total Instances: 2')
    })

    it('should show empty state when no instances configured', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      const sections = wrapper.findAll('.review-section')
      const instancesSection = sections[2] // Third section is instances
      expect(instancesSection.find('.empty-state').exists()).toBe(true)
      expect(instancesSection.text()).toContain('No resource instances configured')
    })
  })

  describe('RBAC Relationships Section', () => {
    it('should display relationship items when relationships are defined', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const relationshipItems = wrapper.findAll('.relationship-item')
      expect(relationshipItems.length).toBe(1)
    })

    it('should display source resource name', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.text()).toContain('test-appservice-prod')
    })

    it('should display target resource name', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.text()).toContain('test-storage-prod')
    })

    it('should display role badge', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.text()).toContain('Contributor')
      expect(wrapper.find('.role-badge').exists()).toBe(true)
    })

    it('should display relationship description', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.text()).toContain('App Service needs access to Storage Account')
    })

    it('should display total relationships count', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const sections = wrapper.findAll('.review-section')
      const rbacSection = sections[3] // Fourth section is RBAC
      expect(rbacSection.text()).toContain('Total Relationships: 1')
    })

    it('should show empty state when no relationships defined', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      const sections = wrapper.findAll('.review-section')
      const rbacSection = sections[3] // Fourth section is RBAC
      expect(rbacSection.find('.empty-state').exists()).toBe(true)
      expect(rbacSection.text()).toContain('No RBAC relationships defined')
    })
  })

  describe('Edit Functionality', () => {
    it('should have edit button for project info', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.find('[data-testid="edit-project-info"]').exists()).toBe(true)
    })

    it('should have edit button for modules', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.find('[data-testid="edit-modules"]').exists()).toBe(true)
    })

    it('should have edit button for instances', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.find('[data-testid="edit-instances"]').exists()).toBe(true)
    })

    it('should have edit button for RBAC', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.find('[data-testid="edit-rbac"]').exists()).toBe(true)
    })

    it('should emit editStep(0) when project info edit button is clicked', async () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      await wrapper.find('[data-testid="edit-project-info"]').trigger('click')
      expect(wrapper.emitted('editStep')).toBeTruthy()
      expect(wrapper.emitted('editStep')?.[0]).toEqual([0])
    })

    it('should emit editStep(1) when modules edit button is clicked', async () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      await wrapper.find('[data-testid="edit-modules"]').trigger('click')
      expect(wrapper.emitted('editStep')).toBeTruthy()
      expect(wrapper.emitted('editStep')?.[0]).toEqual([1])
    })

    it('should emit editStep(2) when instances edit button is clicked', async () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      await wrapper.find('[data-testid="edit-instances"]').trigger('click')
      expect(wrapper.emitted('editStep')).toBeTruthy()
      expect(wrapper.emitted('editStep')?.[0]).toEqual([2])
    })

    it('should emit editStep(3) when RBAC edit button is clicked', async () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      await wrapper.find('[data-testid="edit-rbac"]').trigger('click')
      expect(wrapper.emitted('editStep')).toBeTruthy()
      expect(wrapper.emitted('editStep')?.[0]).toEqual([3])
    })
  })

  describe('Validation', () => {
    it('should show no errors when configuration is complete', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(false)
    })

    it('should show error when project name is missing', () => {
      const incompleteProjectInfo: ProjectInfo = {
        ...mockProjectInfo,
        projectName: ''
      }
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: incompleteProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('Project name is required')
    })

    it('should show error when description is missing', () => {
      const incompleteProjectInfo: ProjectInfo = {
        ...mockProjectInfo,
        description: ''
      }
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: incompleteProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('Project description is required')
    })

    it('should show error when environment is missing', () => {
      const incompleteProjectInfo: ProjectInfo = {
        ...mockProjectInfo,
        environment: '' as any
      }
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: incompleteProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('Environment selection is required')
    })

    it('should show error when owner is missing', () => {
      const incompleteProjectInfo: ProjectInfo = {
        ...mockProjectInfo,
        owner: ''
      }
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: incompleteProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('Project owner is required')
    })

    it('should show error when no modules are selected', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('At least one module must be selected')
    })

    it('should show error when modules are selected but no instances configured', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: [], // No instances despite having modules
          rbacRelationships: []
        }
      })
      expect(wrapper.find('.validation-errors').exists()).toBe(true)
      expect(wrapper.text()).toContain('Resource instances must be configured for selected modules')
    })
  })

  describe('Summary Stats', () => {
    it('should display summary stats cards', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const statCards = wrapper.findAll('.stat-card')
      expect(statCards.length).toBe(3) // Modules, Instances, RBAC
    })

    it('should display correct module count', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const statCards = wrapper.findAll('.stat-card')
      expect(statCards[0].text()).toContain('2')
      expect(statCards[0].text()).toContain('Modules')
    })

    it('should display correct instance count', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const statCards = wrapper.findAll('.stat-card')
      expect(statCards[1].text()).toContain('2')
      expect(statCards[1].text()).toContain('Instances')
    })

    it('should display correct RBAC count', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: mockModules,
          resourceInstances: mockInstances,
          rbacRelationships: mockRbacRelationships
        }
      })
      const statCards = wrapper.findAll('.stat-card')
      expect(statCards[2].text()).toContain('1')
      expect(statCards[2].text()).toContain('RBAC Rules')
    })
  })

  describe('Module Icon Helper', () => {
    it('should return correct icon for compute category', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [{ name: 'Test', category: 'compute', description: 'Test' }],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      // The icon should be 'memory' for compute category
      const moduleIcon = wrapper.find('.module-icon .material-symbols-outlined')
      expect(moduleIcon.text()).toBe('memory')
    })

    it('should return default icon for unknown category', () => {
      const wrapper = mount(ReviewPage, {
        props: {
          projectInfo: mockProjectInfo,
          selectedModules: [{ name: 'Test', category: 'unknown', description: 'Test' }],
          resourceInstances: [],
          rbacRelationships: []
        }
      })
      // The icon should be 'extension' for unknown category
      const moduleIcon = wrapper.find('.module-icon .material-symbols-outlined')
      expect(moduleIcon.text()).toBe('extension')
    })
  })
})
