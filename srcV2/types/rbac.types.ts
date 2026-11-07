/**
 * RBAC Manager Type Definitions
 * 
 * Defines all TypeScript interfaces and types for the RBAC Manager component.
 * Used for managing Azure Role-Based Access Control (RBAC) relationships
 * between infrastructure resources.
 */

/**
 * Azure Built-in Role Definition
 * Represents an Azure RBAC role with scope and description
 */
export interface AzureRole {
  /** Friendly name of the role (e.g., "Contributor", "Reader") */
  name: string

  /** Detailed description of what this role provides */
  description: string

  /** Scope where this role is applicable */
  scope:
    | 'global'      // Available for all resources
    | 'eventgrid'   // Event Grid specific
    | 'servicebus'  // Service Bus specific
    | 'compute'     // Compute resources (VMs, AppService)
    | 'storage'     // Storage accounts and blobs
    | 'database'    // SQL, Cosmos DB
    | 'security'    // Key Vault, security-related
    | 'web'         // App Service, Web-specific

  /** Azure built-in role ID (GUID) for API references */
  id: string
}

/**
 * Azure Resource Instance
 * Represents an Azure resource that RBAC relationships can be defined for
 */
export interface Resource {
  /** Unique identifier for this resource (e.g., "resource-AppService") */
  id: string

  /** Display name of the resource (e.g., "AppService", "KeyVault") */
  name: string

  /** Type of Azure resource (e.g., "App Service", "Key Vault") */
  type: string

  /** Human-readable description of this resource */
  description: string

  /** Optional category for grouping (compute, storage, security, etc.) */
  category?: string
}

/**
 * RBAC Relationship
 * Defines an access relationship: Source Resource --(Role)--> Target Resource
 * Example: "AppService" --"Key Vault Secrets User"--> "KeyVault"
 */
export interface RBACRelationship {
  /** Unique identifier for this relationship */
  id: string

  /** Name of the source resource (who needs access) */
  sourceName: string

  /** Resource ID of the source (e.g., "resource-AppService") */
  sourceResource: string

  /** Azure role name (what permissions are granted) */
  role: string

  /** Name of the target resource (what is being accessed) */
  targetName: string

  /** Resource ID of the target (e.g., "resource-KeyVault") */
  targetResource: string

  /** Optional description of why this relationship exists */
  description?: string

  /** ISO timestamp when this relationship was created */
  createdAt?: string

  /** ISO timestamp when this relationship was last updated */
  updatedAt?: string
}

/**
 * RBAC Manager State
 * Complete state object for the RBAC Manager Pinia store
 */
export interface RBACManagerState {
  /** List of available resources to create relationships for */
  resources: Resource[]

  /** List of defined RBAC relationships */
  relationships: RBACRelationship[]

  /** IDs of currently selected resources */
  selectedResources: string[]

  /** Loading state indicator */
  loading: boolean

  /** Error message if any operation fails */
  error: string | null
}

/**
 * RBAC Manager Modal Props
 * Props passed to the RBACManagerModal component
 */
export interface RBACManagerModalProps {
  /** Whether the modal is visible */
  isOpen: boolean

  /** Callback when modal should close */
  onClose: () => void

  /** Callback when relationships are saved */
  onSave: (relationships: RBACRelationship[]) => void

  /** Optional initial relationships to load */
  initialRelationships?: RBACRelationship[]
}

/**
 * Resources List Props
 * Props for the ResourcesList component
 */
export interface ResourcesListProps {
  /** Array of resources to display */
  resources: Resource[]

  /** IDs of currently selected resources */
  selectedIds: string[]

  /** Whether multiple selection is allowed */
  multiSelect?: boolean
}

/**
 * Relationships List Props
 * Props for the RelationshipsList component
 */
export interface RelationshipsListProps {
  /** Array of relationships to display */
  relationships: RBACRelationship[]

  /** Whether to show edit button */
  editable?: boolean

  /** Whether to show delete button */
  deletable?: boolean
}

/**
 * Add Relationship Form Props
 * Props for the AddRelationshipForm component
 */
export interface AddRelationshipFormProps {
  /** Available resources for source/target dropdowns */
  resources: Resource[]

  /** Available Azure roles for role dropdown */
  roles: AzureRole[]

  /** Optional existing relationship to edit */
  editingRelationship?: RBACRelationship

  /** Whether form is in loading state */
  loading?: boolean
}

/**
 * Validation Result
 * Result of validating a RBAC relationship
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean

  /** Error message if validation failed */
  error?: string

  /** Field that caused validation error */
  field?: keyof RBACRelationship
}

/**
 * Session Storage Format
 * Format for storing module data in session storage
 */
export interface SessionStorageModuleData {
  /** Unique identifier for the module instance */
  id: string

  /** Name of the module (e.g., "AppService") */
  name: string

  /** Type of the module (e.g., "App Service") */
  type: string

  /** Material Icons icon name */
  icon: string

  /** Human-readable description */
  description: string

  /** Terraform module type name */
  moduleType: string

  /** Index of this instance if multiple */
  instanceIndex: number
}

/**
 * Exported Relationship Format
 * Format used when exporting relationships to parent page
 */
export interface ExportedRelationship {
  /** Name of the source resource */
  sourceName: string

  /** ID of the source resource */
  sourceResource: string

  /** Name of the Azure role */
  role: string

  /** Name of the target resource */
  targetName: string

  /** ID of the target resource */
  targetResource: string

  /** Optional description */
  description?: string
}

/**
 * Post Message Event
 * Format for postMessage communication between windows
 */
export interface PostMessageEvent {
  /** Type of message being sent */
  type: 'RBAC_RELATIONSHIPS_UPDATED' | 'RBAC_ERROR' | 'RBAC_READY'

  /** Message payload data */
  data?: RBACRelationship[] | ExportedRelationship[] | string | null

  /** Error message if type is RBAC_ERROR */
  error?: string
}

/**
 * Azure Roles Database
 * Complete list of Azure built-in roles organized by scope
 */
export type AzureRolesDatabase = Record<AzureRole['scope'], AzureRole[]>
