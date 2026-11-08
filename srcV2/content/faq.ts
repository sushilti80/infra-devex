import type { PageId } from '../stores/navigation'

export type FaqCategoryId = 'basics' | 'how-it-works' | 'features' | 'environments' | 'security' | 'troubleshooting'

export interface FaqCategory {
  id: FaqCategoryId
  label: string
}

export interface FaqItem {
  id: string
  category: FaqCategoryId
  question: string
  /** One string per paragraph. Plain text only. */
  answer: string[]
}

export interface UseCase {
  id: string
  title: string
  persona: string
  icon: string
  goal: string
  steps: string[]
  outcome: string
  /** Page the "Try it" button navigates to (authenticated users only). */
  page: PageId
  pageLabel: string
}

export const faqCategories: FaqCategory[] = [
  { id: 'basics', label: 'The basics' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'features', label: 'Features' },
  { id: 'environments', label: 'Environments' },
  { id: 'security', label: 'Approvals & security' },
  { id: 'troubleshooting', label: 'Troubleshooting' }
]

export const faqItems: FaqItem[] = [
  // ── The basics ────────────────────────────────────────────────────────────
  {
    id: 'what-is-self-service',
    category: 'basics',
    question: 'What is Self-Service Infrastructure?',
    answer: [
      'A web portal where you request Azure infrastructure by choosing what you need (for example a SQL database, a Key Vault and an App Service) instead of writing Terraform yourself or raising a ticket with the platform team.',
      'You describe the outcome you want, the portal turns it into infrastructure code, and the standard review and deployment pipeline does the rest.'
    ]
  },
  {
    id: 'thin-layer',
    category: 'basics',
    question: 'Is this a new way of provisioning, or a layer over our existing pipeline?',
    answer: [
      'It is a thin layer over the existing infrastructure-as-code pipeline. The portal does not create anything in Azure directly and does not hold its own cloud state.',
      'It collects and validates your request, generates the same Terraform/Terragrunt configuration an engineer would write by hand, and opens a GitHub Pull Request. Provisioning is still performed by the normal GitHub Actions and Terraform workflows after the PR is approved and merged.'
    ]
  },
  {
    id: 'who-is-it-for',
    category: 'basics',
    question: 'Who should use it?',
    answer: [
      'Any engineer who needs sandbox Azure resources, deploys containers to the AKS Playground, or wants a common change made to existing infrastructure. You do not need direct Azure access.'
    ]
  },
  {
    id: 'sandbox-only',
    category: 'basics',
    question: 'Is it for production?',
    answer: [
      'The portal is designed for sandbox environments. When an application is ready for enterprise use it is migrated to the infrastructure-live cadence, which owns the full production lifecycle.'
    ]
  },

  // ── How it works ──────────────────────────────────────────────────────────
  {
    id: 'what-is-intent',
    category: 'how-it-works',
    question: 'What do you mean by "intent"?',
    answer: [
      'An intent is what you want, not how to build it: "a storage account and a Key Vault for project X in devsand", "add a Service Bus topic subscription for this function", "deploy this image to AKS".',
      'You express intent through forms and module pickers. The portal maps that intent to a vetted Terraform module or a specialised agent, so naming, tagging, SKUs and wiring follow platform standards without you needing to know them.'
    ]
  },
  {
    id: 'request-lifecycle',
    category: 'how-it-works',
    question: 'What happens after I click Submit?',
    answer: [
      '1. The portal validates your input and generates the infrastructure code and metadata.',
      '2. A Pull Request is opened in the service catalog repository and a GitHub Actions workflow is triggered.',
      '3. A status dialog tracks the request using a correlation ID and updates until it succeeds, fails or times out.',
      '4. A Principal Engineer or DevOps team member reviews the PR. Once it is merged the pipeline provisions the resources.',
      '5. The app then appears under Installed Apps.'
    ]
  },
  {
    id: 'no-database',
    category: 'how-it-works',
    question: 'Where is my application data stored?',
    answer: [
      'GitHub is the single source of truth. Each application has a metadata JSON file (project, environment, owner, modules, status and so on) in the service catalog repository. There is no separate database, so everything is versioned and auditable through Git history.'
    ]
  },
  {
    id: 'correlation-id',
    category: 'how-it-works',
    question: 'What is the correlation ID shown in the status dialog?',
    answer: [
      'A unique ID attached to your request. It appears in server logs, the PR description, workflow runs and API responses. Quote it when you ask for support and the team can trace your request end to end.'
    ]
  },

  // ── Features ──────────────────────────────────────────────────────────────
  {
    id: 'features-overview',
    category: 'features',
    question: 'What can I do in the portal?',
    answer: [
      'Custom Infrastructure: compose Azure resources from catalog modules.',
      'AKS Playground: deploy your own container image to Kubernetes.',
      'Installed Apps: see, edit and delete what you have provisioned.',
      'Existing Infrastructure Change: request common changes through specialised agents.',
      'Request Feature/Bugfix: send feedback straight into the team backlog.'
    ]
  },
  {
    id: 'which-modules',
    category: 'features',
    question: 'Which Azure resources can I build?',
    answer: [
      'Storage accounts, Key Vault, user-assigned managed identities, RBAC assignments, App Service (Windows and Linux), Function Apps, Service Bus, Event Hub, Event Grid topics, Azure SQL, PostgreSQL, App Configuration, Redis, Linux and Windows VMs, Durable Task Scheduler and AI Foundry. The Custom Infrastructure page always shows the current list.'
    ]
  },
  {
    id: 'rbac',
    category: 'features',
    question: 'How do I give one resource access to another?',
    answer: [
      'Use the RBAC step in Custom Infrastructure to define relationships between the resources you selected (for example an App Service reading from a Key Vault). The role assignments are generated into the same PR.'
    ]
  },
  {
    id: 'edit-existing',
    category: 'features',
    question: 'Can I change an app after it has been created?',
    answer: [
      'Yes. Open Installed Apps and choose Edit. The Custom Infrastructure wizard opens pre-filled with the modules, instances and RBAC relationships of that app so you can add or remove resources.',
      'For common targeted changes (topic subscriptions, storage queues and containers, Service Bus) use Existing Infrastructure Change instead.'
    ]
  },
  {
    id: 'agents',
    category: 'features',
    question: 'What are agents in Existing Infrastructure Change?',
    answer: [
      'Agents are specialised automations for a single kind of change. You pick an agent, fill in its inputs and submit. The portal dispatches a workflow that produces the infrastructure change as a Pull Request.',
      'Available agents today: topic subscription (Event Grid and Service Bus), storage (queues, containers and tables) and Service Bus. More are added over time; you can ask for one through Request Feature/Bugfix.'
    ]
  },
  {
    id: 'aks-playground',
    category: 'features',
    question: 'How does the AKS Playground work?',
    answer: [
      'Bring your own container. Push your image to the EXAMPLE Container Registry, then give the portal the app name, namespace, image and tag. It generates the Kubernetes manifests, wires up ingress for web apps, and can map Key Vault secrets into Kubernetes using ExternalSecret.',
      'Use a specific image tag rather than latest, and make sure any Key Vault secrets exist before the PR merges.'
    ]
  },
  {
    id: 'delete',
    category: 'features',
    question: 'How do I remove resources I no longer need?',
    answer: [
      'Delete the application from Installed Apps. This triggers an automated Terraform destroy workflow and cleans up the metadata. Remove sandbox resources you are finished with to avoid unnecessary cost.'
    ]
  },

  // ── Environments ──────────────────────────────────────────────────────────
  {
    id: 'which-environments',
    category: 'environments',
    question: 'Which environments are available?',
    answer: [
      'devsand (default development sandbox), sand (IT sandbox) and dataopssand (DataOps sandbox). AKS Playground is available in devsand and sand only.',
      'Environments and their enabled features are loaded from configuration at runtime, so the dropdowns only show what is available to you.'
    ]
  },
  {
    id: 'env-missing',
    category: 'environments',
    question: 'An environment or feature is missing from the dropdown. Why?',
    answer: [
      'Each environment has feature flags (custom infrastructure, templates, AKS). If a feature is off for an environment it is hidden for that environment. Request enablement through Request Feature/Bugfix.'
    ]
  },
  {
    id: 'promote-to-prod',
    category: 'environments',
    question: 'How do I take a sandbox app to production?',
    answer: [
      'Before you promote, make sure your proof of concept has been completed successfully in devsand and the app is ready to move on to the delivery path.',
      'Open Installed Apps, find the app and click the Promote to Delivery Path icon (the up arrow). The icon is available while the app is in the experimental or development lifecycle. Enter the CR number for the change, select the environments you need, and submit.',
      'The portal then starts the move to infrastructure-live workflow with your CR number and selected environments. Follow its progress in the status dialog, and check with the DevOps team if the promotion needs review.'
    ]
  },

  // ── Approvals & security ──────────────────────────────────────────────────
  {
    id: 'approval',
    category: 'security',
    question: 'Who approves my request?',
    answer: [
      'A Principal Engineer or a DevOps team member reviews the generated Pull Request. This keeps code quality and compliance consistent without you needing Azure permissions.'
    ]
  },
  {
    id: 'login',
    category: 'security',
    question: 'How do I sign in?',
    answer: [
      'With your Microsoft Entra ID work account. Authentication uses bearer tokens validated by the backend; there is no separate password for the portal.'
    ]
  },
  {
    id: 'sku-changes',
    category: 'security',
    question: 'Can I choose a bigger SKU or a different region?',
    answer: [
      'Modules are provisioned with standard sandbox values. If you need something different, work with a Principal Engineer or the DevSecOps team for a custom configuration.'
    ]
  },
  {
    id: 'two-apps',
    category: 'security',
    question: 'Why are there two GitHub Apps behind the portal?',
    answer: [
      'Least privilege. The Infrastructure app provisions and deletes infrastructure and manages metadata. The Code Deployment app handles application code and AKS deployments. Their credentials are never mixed.'
    ]
  },

  // ── Troubleshooting ───────────────────────────────────────────────────────
  {
    id: 'stuck-in-progress',
    category: 'troubleshooting',
    question: 'My request seems stuck in "In Progress".',
    answer: [
      'If a PR is waiting for review the infrastructure will not be provisioned yet. Check the PR link in the status dialog, then check the linked workflow run. If neither explains the delay, send the correlation ID to the DevOps team.'
    ]
  },
  {
    id: 'app-not-listed',
    category: 'troubleshooting',
    question: 'My app is not in Installed Apps.',
    answer: [
      'The app is listed after its PR is merged and the metadata is committed. Refresh after a short wait. If the PR was closed without merging the app will never appear.'
    ]
  },
  {
    id: 'request-failed',
    category: 'troubleshooting',
    question: 'My deployment failed. What now?',
    answer: [
      'Open the workflow run linked from the status dialog and read the failing step. Validation errors (naming, missing secrets, bad image tag) can usually be fixed and resubmitted. For anything else, report it with the correlation ID.'
    ]
  },
  {
    id: 'report-bug',
    category: 'troubleshooting',
    question: 'How do I report a bug or ask for a feature?',
    answer: [
      'Use Request Feature/Bugfix in the navigation. Choose bug, feature request or agent request; the portal creates a structured GitHub Issue for the team.'
    ]
  },
  {
    id: 'architecture-help',
    category: 'troubleshooting',
    question: 'I am not sure what to build. Where can I get design help?',
    answer: [
      'Use the public Azure Architecture Center for reference architectures and design guidance. Review your design with your platform engineering team before provisioning resources.'
    ]
  }
]

export const useCases: UseCase[] = [
  {
    id: 'new-web-backend',
    title: 'Stand up a backend for a new web app',
    persona: 'Application developer starting a new service',
    icon: 'web',
    goal: 'You need an App Service, a SQL database, a Key Vault and a way for the app to read secrets, all in devsand.',
    steps: [
      'Open Custom Infrastructure and enter the project abbreviation, service name, owner and environment.',
      'Select App Service, Azure SQL, Key Vault and a user-assigned managed identity.',
      'In the RBAC step, grant the identity access to the Key Vault.',
      'Submit. Follow the status dialog while the PR is created and reviewed.'
    ],
    outcome: 'After the PR is approved and merged, the resources are provisioned and the app is listed under Installed Apps.',
    page: 'custom',
    pageLabel: 'Custom Infrastructure'
  },
  {
    id: 'event-driven',
    title: 'Build an event-driven function',
    persona: 'Developer building asynchronous processing',
    icon: 'bolt',
    goal: 'A Function App should react to messages from Service Bus and keep files in a storage account.',
    steps: [
      'In Custom Infrastructure, select Function App, Service Bus and Storage Account.',
      'Add RBAC relationships so the function can read the queue and write to storage.',
      'Submit and wait for approval.',
      'Later, use Existing Infrastructure Change with the topic subscription agent to subscribe the function to a topic.'
    ],
    outcome: 'The infrastructure is created once, and event wiring is added through a focused change rather than a rebuild.',
    page: 'custom',
    pageLabel: 'Custom Infrastructure'
  },
  {
    id: 'deploy-container',
    title: 'Run a container on AKS',
    persona: 'Developer with a containerised service',
    icon: 'package_2',
    goal: 'Get an existing image running on the sandbox Kubernetes cluster without writing manifests.',
    steps: [
      'Push the image with a specific tag to the EXAMPLE Container Registry.',
      'Open AKS Playground and pick devsand or sand.',
      'Enter app name, namespace and image; choose App or Agent.',
      'Add environment variables, secret variables or Key Vault mappings, then deploy.'
    ],
    outcome: 'Manifests are generated and applied, an ingress is created for web apps, and progress is tracked in the status dialog.',
    page: 'aks',
    pageLabel: 'AKS Playground'
  },
  {
    id: 'topic-subscription',
    title: 'Subscribe a function to a topic',
    persona: 'Developer integrating with existing messaging',
    icon: 'router',
    goal: 'Your function must receive events from an Event Grid topic or Service Bus topic.',
    steps: [
      'Open Existing Infrastructure Change and choose the topic subscription agent.',
      'Provide the Jira ticket, subscription type, function app, topic and function endpoint names.',
      'Review and submit.'
    ],
    outcome: 'The agent prepares the subscription change as a Pull Request across the requested environments.',
    page: 'change',
    pageLabel: 'Existing Infrastructure Change'
  },
  {
    id: 'add-storage-resources',
    title: 'Add a queue or container to a storage account',
    persona: 'Developer needing a small addition',
    icon: 'storage',
    goal: 'An existing storage account needs a new queue, blob container or table.',
    steps: [
      'Open Existing Infrastructure Change and choose the storage agent.',
      'Enter the Jira or CR reference, resource type, storage account names and resource names.',
      'Optionally request a poison queue, then submit.'
    ],
    outcome: 'You get a reviewable PR with the new resources instead of waiting on a manual ticket.',
    page: 'change',
    pageLabel: 'Existing Infrastructure Change'
  },
  {
    id: 'grow-existing-app',
    title: 'Add a resource to an app you already created',
    persona: 'Developer whose requirements changed',
    icon: 'edit_square',
    goal: 'The app now needs a Redis cache alongside the resources it already has.',
    steps: [
      'Open Installed Apps and choose Edit on the application.',
      'The wizard opens pre-filled with existing modules, instances and RBAC.',
      'Add Redis and any RBAC relationship, then submit.'
    ],
    outcome: 'Only the additions are reviewed and applied; existing resources stay as they are.',
    page: 'apps',
    pageLabel: 'Installed Apps'
  },
  {
    id: 'clean-up',
    title: 'Tear down an experiment',
    persona: 'Developer finishing a proof of concept',
    icon: 'delete',
    goal: 'Remove sandbox resources you no longer need.',
    steps: [
      'Open Installed Apps and locate the application using search or filters.',
      'Choose Delete and confirm.',
      'Watch the destroy workflow in the status dialog.'
    ],
    outcome: 'Resources are destroyed by the pipeline and the catalog entry is cleaned up.',
    page: 'apps',
    pageLabel: 'Installed Apps'
  },
  {
    id: 'missing-capability',
    title: 'Ask for something the portal cannot do yet',
    persona: 'Anyone',
    icon: 'rate_review',
    goal: 'You need a module, agent or environment feature that is not available.',
    steps: [
      'Open Request Feature/Bugfix.',
      'Choose Feature request or Agent request and describe the pain point and the outcome you expect.',
      'Submit.'
    ],
    outcome: 'A structured GitHub Issue is created for the team with a correlation ID for follow-up.',
    page: 'feedback',
    pageLabel: 'Request Feature/Bugfix'
  }
]
