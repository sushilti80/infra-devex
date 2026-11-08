/**
 * Infrastructure Data Types
 * Based on Self-Service-Infra.AppArchitect.json specification
 */

// Environment type - dynamic string instead of hardcoded union
export type Environment = string

export type Lifecycle = 'experimental' | 'development' | 'production'

export type InfrastructureStatus = 'provisioning' | 'active' | 'failed' | 'deleting' | 'deleted' | 'pending_deletion'

export interface Infrastructure {
  projectName: string // maxLength: 8
  descriptiveName: string // maxLength: 100
  environment: Environment
  owner: string
  modules: string[]
  lifecycle: Lifecycle
  projectAge: number
  createdAt: string
  status: InfrastructureStatus
  approvalNumber?: string
  resourceGroup?: string
  subscriptionId?: string
}

export interface SecretFormEntry {
  name: string
  value: string
  confirmation: string
}

export interface InstalledApp {
  name: string
  environment: Environment
  owner: string
  deployedAt: string
  lifecycle: Lifecycle
  status: InfrastructureStatus
  modules: string[]
  description?: string
  descriptiveName?: string
  projectAge?: number
  approvalNumber?: string
  resourceGroup?: string
  subscriptionId?: string
  age?: string
  version?: string
  costCenter?: string    // FR-008: cost center tag from service-catalog metadata
  commitSha?: string     // FR-008: most recent commit SHA from service-catalog metadata
}

/** FR-008: Normalized app metadata returned by GET /api/app-metadata/:appName/:environment */
export interface AppMetadata {
  name: string           // project abbreviation (≤ 8 chars)
  environment: string    // environment identifier
  description: string    // human-readable description
  owner: string          // owner name or email
  lifecycle: string      // "experimental" | "production" | "deprecated"
  modules: string[]      // Terraform module IDs
  rbacPairs?: RbacRelationship[] // optional RBAC relationships restored from metadata rbac_pairs
  costCenter: string     // cost center tag
  commitSha: string      // most recent commit SHA
  deployedAt: string     // ISO 8601 deployment timestamp
}

export interface Module {
  id?: string
  name: string
  description: string
  category: string
  version?: string
  supportsMultiInstance?: boolean
  parameters?: Record<string, any>
}

export interface AKSDeployedApp {
  // identifiers
  project: string          // top-level "project" from flux-config JSON
  appname: string          // meta.appname
  namespace: string        // meta.namespace
  environment: string      // top-level "environment"
  deploymentType: 'app' | 'agent'  // derived from top-level "type" (webapp→app)
  // image
  imageName: string        // meta.image_name
  imageTag: string         // meta.image_tag
  // config
  port?: string
  healthPath?: string
  exposureMode?: 'legacy' | 'private-gateway'
  exposureUrl?: string | null
  postgresDatabase?: {
    enabled?: boolean
    database_name: string
    parent_server: string
    parent_resource_group: string
    managed_by: string
    reconcile_policy: string
    deletion_policy: string
    desired_status?: string
    namespace?: string
    manifest_path?: string
    flux_kustomization?: string
  } | null
  gitops?: {
    repository: string
    cluster: string
    namespace: string
    namespaceOwned: boolean
    appPath: string
    owners: Array<{ name: string; manifest: string; path: string; role: string; prune: boolean }>
  } | null
  resourceInventory?: {
    source: string
    declared: Array<{ kind: string; name: string; namespace: string; controller: string; reconcilePolicy?: string; onDelete: string }>
    helmManagedCandidates: Array<{ kind: string; sourceHelmRelease: string; verification: string }>
  } | null
  lifecycle?: { status: string; deletionPhase?: string | null } | null
  deletionEligible?: boolean
  teamLabel?: string
  externalSecretEnabled?: boolean
  workloadIdentityEnabled?: boolean
  // tracking
  version?: string         // top-level "version"
  commitSha?: string       // meta.commit_sha
  commitShas?: string[]    // top-level "commitshas"
  owner: string            // meta.triggered_by
  deployedAt: string       // meta.deployed_at
  correlationId: string    // meta.correlation_id
  status: string
}

export interface ProjectInfo {
  projectName: string
  description: string
  environment: string
  owner: string
  lifecycle: string
  projectAge: number
  approvalNumber: string
}

export interface ResourceInstance {
  id: string
  name: string
  moduleType: string
  nameError?: string
}

export interface RbacRelationship {
  id: string
  sourceId: string
  sourceName: string
  targetId: string
  targetName: string
  role: string
  description?: string
}

export interface WorkloadIdentityGrant {
  /** Matches roles.json scope values: 'security', 'storage', 'ai', 'servicebus',
   *  'appconfiguration', 'database', 'compute', 'web', 'eventgrid'.
   *  Excludes 'global' (subscription-scoped roles are not self-service). */
  resourceType: string
  /** Actual Azure resource name (e.g., 'my-keyvault', 'myStorageAccount').
   *  flux-config uses this to construct the ARM resource ID. */
  resourceName: string
  /** Azure built-in role name from roles.json matching the resourceType scope. */
  role: string
}

export interface Template {
  name: string
  description: string
  modules: string[]
  category?: string
}

export interface WorkflowStatus {
  correlationId: string
  status: 'pending' | 'in_progress' | 'success' | 'failure' | 'completed' | 'failed' | 'timeout' | 'not_found' | 'queued'
  percentage: number
  message?: string
  prUrl?: string
  prNumber?: string | number
  workflowUrl?: string
  resultUrl?: string
  error?: string
  createdAt?: string
  updatedAt?: string
  conclusion?: string
  steps?: Array<{
    label: string
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
  }>
}

export interface CustomInfrastructureRequest {
  projectName: string
  descriptiveName: string
  environment: Environment
  owner: string
  lifecycle: Lifecycle
  projectAge: number
  approvalNumber: string
  modules: string[]
  correlationId: string
}

export interface TemplateDeployRequest {
  templateName: string
  projectName: string
  descriptiveName: string
  environment: Environment
  owner: string
  approvalNumber: string
  correlationId: string
}

export interface DeleteInfrastructureRequest {
  projectName: string
  environment: Environment
  correlationId: string
}

export interface PromoteInfrastructureRequest {
  projectName: string
  sourceEnvironment: Environment
  targetEnvironment: Environment
  approvalNumber: string
  correlationId: string
}

export interface AKSDeployRequest {
  appName: string
  namespace: string
  environment: Environment
  imageRepository: string
  imageTag: string
  replicas: number
  ports: number[]
  correlationId: string
}

export interface RBACRelationship {
  id: string
  principalType: 'user' | 'group' | 'servicePrincipal'
  principalId: string
  principalName: string
  roleDefinition: string
  resourceType: string
  resourceName: string
  scope: string
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  details?: string | any[]
  status?: string
  correlationId?: string
  prUrl?: string
  prNumber?: number
  secretCount?: number
  vaults?: Array<{ vaultDir: string; vaultName: string | null; resourceGroup: string | null }>
  url?: string
  workflowUrl?: string
  resultUrl?: string
}

export interface AzureConfig {
  subscriptions: Record<string, string>
  defaultSubscriptionId: string
}

/** secrets-environment-bundles (FR-001/FR-002/FR-007): one entry in the `bundles` catalog returned
 * alongside `GET /api/secrets/apps`'s `data[]`, derived server-side from data/secretBundles.json.
 * Membership (which environments belong to this bundle) is conveyed per-app-entry via
 * `bundleId`, not here — see spec.md §2.2. */
export interface BundleCatalogEntry {
  id: string
  displayName: string
  order: number
  releaseControlled: boolean
}

/** secrets-environment-bundles (FR-006): one secret name/value pair scoped to a single
 * environment within a bundle submission — never shared/copied across environments. */
export interface BundleSecretValue {
  secretName: string
  secretValue: string
}

/** secrets-environment-bundles (FR-005): one environment's contribution to a bundle-mode
 * POST /api/secrets request body's `environmentSecrets[]` array. */
export interface BundleEnvironmentSecrets {
  environment: string
  vaultDir?: string
  qualifier?: string
  secrets: BundleSecretValue[]
}

/** secrets-environment-bundles (FR-004(c)/(g)): an eligible-but-deployed bundle environment that
 * was excluded from a submission because of vault/qualifier ambiguity, along with the raw
 * candidates so the UI can offer a disambiguation control. */
export interface BundleExcludedEnvironment {
  environment: string
  reason: string
  vaults?: Array<{ vaultDir: string; vaultName: string | null; resourceGroup: string | null }>
  qualifiers?: string[]
}

/** secrets-environment-bundles: response shape of a bundle-mode POST /api/secrets submission
 * (success or failure). `branchName`/`commitSha` are only present for the PR_CREATION_FAILED
 * resolved-not-thrown outcome (spec.md §2.4). */
export interface BundleSubmitResponse {
  success: boolean
  correlationId: string
  bundleId: string
  prNumber?: number
  prUrl?: string
  includedEnvironments: string[]
  excludedEnvironments: BundleExcludedEnvironment[]
  secretCount: number
  errorCode?: string
  branchName?: string
  commitSha?: string
  error?: string
}
