# AKS Playground guide

Use the AKS Playground to deploy an existing container image from the AYA Azure Container Registry (ACR) to an AKS sandbox. The Playground does not build your application or Docker image. You build and push the image first, then provide its registry path and tag.

## Deployment flow

1. Create and test a Dockerfile in your application repository.
2. Push a tagged image to the AYA ACR. You can build and push it yourself, or optionally use the Docker build pipeline guidance below.
3. Sign in to Self-Service Infrastructure and open **AKS Playground**.
4. Choose the environment, configure the application, and submit. The Playground deploys an App and uses either the current legacy ingress (default) or the opt-in Kong Gateway private-hostname pilot in devsand.
5. Follow the workflow status. When the deployment completes, find the application in **AKS Deployed Applications**.

## Prerequisites

- Your application has a working Dockerfile and listens on the port you plan to configure.
- The image is pushed to an ACR that the selected AKS environment can pull from.
- You know the full image repository path and the exact tag. For example, image name `sharedwus3acr2.azurecr.io/team/my-app` and tag `1.2.3`.
- You can sign in to Self-Service Infrastructure and have access to the AKS Playground.
- You have the required environment variables and secret references ready.

The image tag defaults to editable `0.0.1`. Confirm that this tag exists in ACR, or
replace it with a published tag before submitting. The initial PR uses the supplied
tag; it does not resolve the newest image. A nonexistent tag can cause image-pull
failures until an available tag is selected.

After the PR merges, Flux image automation selects the highest eligible `X.Y.Z`
tag and commits updates to `main`. Image scanning and update automation each use
5-minute reconciliation intervals, so updates are asynchronous, not immediate.
The supplied tag is an initial version, not a pin. Other valid image tags remain
allowed; strict semver validation is not needed for rotation. The policy filters
ACR tags, excluding `latest`, build-ID-only tags, `v` prefixes, and prerelease tags.

## Optional: set up the Docker build pipeline

If your application repository does not already build and push images to ACR, use the [Docker Build v3 agent prompt](https://github.com/Aya-DevOpsTeam/docker-infra-live/blob/main/docs/AGENT_PROMPT_WIRE_DOCKER_BUILDV3.md) from a coding agent while it is working in your application repository. Do this after you have a Dockerfile and before deploying through the Playground. The prompt guides the agent to wire your repository to the shared Azure DevOps template; it does not ask you to copy the template into your repository.

The shared pipeline runs Semgrep, builds with Podman, scans the image with Wiz, and pushes it to `sharedwus3acr2`. On `main` or `master`, it pushes a semantic version tag and `latest`. On other branches and pull requests, it pushes a build ID tag and `buildcache` when image pushing is enabled. Use the exact tag that the pipeline reports and publishes.

The pipeline needs setup by an Azure DevOps administrator or someone with the required permissions:

- Create an Azure DevOps pipeline that points to the generated YAML file.
- Authorize the pipeline to use the `shared-acr-connection` service connection, the `Aya-DevOpsTeam` GitHub connection, and the `podman-pool-1` agent pool.
- Ensure the service connection can push to ACR `sharedwus3acr2` and read the required Key Vault secrets.
- Optionally add `RENOVATE_GITHUB_TOKEN` or `GITHUB_TOKEN` as a secret pipeline variable to enable pull request version comments.

The prompt leaves Goss validation disabled unless the Dockerfile has `test` and `final` stages, a neighboring `goss.yaml`, and a `test` stage that runs Goss and fails when checks fail. Do not enable it unless those conditions are met.

## Deploy an image

1. Open **AKS Playground**. Select an environment from the list. The list only shows environments with AKS enabled; the current catalog enables `devsand` and `sand`.
2. Enter an application name. Use lowercase letters, numbers, and hyphens, and start and end with a letter or number. The name must be 63 characters or fewer.
3. Confirm the namespace. It defaults from the application name and follows the same naming rules. Change it only when the workload needs a separate namespace.
4. Enter the container image repository and tag separately. The image field accepts the registry and repository path; the tag field accepts the image version. The image repository may be prefilled from the app name, so verify it matches the image you pushed.
5. Configure the application fields. Use the feature reference below to decide which optional settings apply.
6. Select **Deploy to AKS** and keep the status modal open until the workflow reaches a terminal state. If the workflow creates a pull request that requires approval or merging, complete that step before expecting the workload to run.
7. After success, open **AKS Deployed Applications** and refresh the list to verify the application, namespace, environment, image, owner, and deployment date.

The Playground deploys HTTP/HTTPS applications with a Kubernetes deployment, service, ingress, health checks, environment variables, and optional Key Vault integration. There is no deployment-type selector or Agent configuration.

## Application exposure through Kong Gateway

**Legacy ingress (current default)** deploys the app with the workload chart's built-in NGINX Ingress and Azure Private DNS A record. This remains the default until the Kong Gateway pilot completes testing.

**Kong Gateway — private hostname (devsand pilot)** is available only to new devsand web applications with matching application and namespace names. It keeps the workload chart's Deployment/Service/identity/secrets, disables the workload chart's Ingress and DNS, and generates separate Kong routing, TLS, and DNS HelmReleases. These start **suspended** and require platform readiness, approval, and staged activation.

The pilot does **not** publish public DNS. A private DNS hostname resolving to a public DCGW endpoint is not a network access restriction; gateway security policy and actual access paths must be verified before activation.

After runtime and security validation, Kong Gateway is intended to become the default onboarding path and the legacy ingress path will be retired through a separate reviewed change. That future migration is not enabled by this PR.

## Feature reference

### Shared fields

| Field | What it does | When to use it |
| --- | --- | --- |
| **Environment** | Selects the AKS-enabled sandbox where the workflow deploys. | Choose the environment that owns the target cluster and its Key Vault resources. Only enabled environments appear. |
| **Application Name** | Names the application deployment. | Use a unique, Kubernetes-compatible name for the workload. The form also uses it to suggest a namespace and image path. |
| **Namespace** | Sets the Kubernetes namespace for the workload. | Keep the default when the app should use its own matching namespace. Change it only when you have a reason and the namespace is permitted in the target environment. |
| **Container Image** | Sets the registry and repository, for example `sharedwus3acr2.azurecr.io/team/my-app`. | Enter the image you pushed. Do not include the tag here; enter it in **Image Tag**. |
| **Image Tag** | Sets the initial image version; defaults to editable `0.0.1`. | Use a tag that exists in ACR. Flux later updates the version to the highest eligible `X.Y.Z` tag after reconciliation. |

### App configuration

These fields are always available.

| Field | What it does | When to use it |
| --- | --- | --- |
| **Team Label** | Applies a team label to the Kubernetes namespace. | Keep the suggested value if it identifies your owning team; otherwise enter the label used by your team. |
| **Application Port** | Sets the port the container listens on. The default is `80`. | Change it when the application listens on a different container port. The port must be between 1 and 65535. |
| **Health Check Path** | Sets the endpoint used by liveness and readiness probes. The default is `/healthz`. | Set it to an endpoint that the container serves successfully. Verify the path and port in the application before deploying. |
| **Environment Variables** | Adds plain name/value pairs to the container environment at runtime. | Use for non-sensitive configuration such as feature flags or log levels. Do not enter passwords, tokens, or other secrets here. |
| **Secret Env Vars** | Maps an application environment variable name to a key in a Kubernetes Secret. The form asks for the variable name and secret key, not a secret value. | Use when the value is already made available as a Kubernetes Secret for this workload. Confirm the expected Secret and key exist before deploying. |

### Secrets and Azure access

| Feature | What it does | When to use it |
| --- | --- | --- |
| **Key Vault Integration (ExternalSecret)** | Requests an `ExternalSecret` that synchronizes named Azure Key Vault secrets into a Kubernetes Secret. For each entry, map a Key Vault secret name to a Kubernetes Secret key. | Use it when the workload needs secrets stored in the selected environment's Key Vault. Add only secret names that already exist there. Missing secrets can prevent pods from starting. |
| **External Resource Access (Workload Identity)** | Each deployment has a managed identity named `<application-name>-uami`, a federated credential, and a Kubernetes service account. Grants authorize that identity to access selected Azure resources without putting credentials in the container. | Add a grant when application code calls Azure services such as Storage or Key Vault using `DefaultAzureCredential()`. Select a resource type and role, then enter the Azure resource name, not its full ARM ID. |

Key Vault `ExternalSecret` sync and Workload Identity grants solve different problems. Use `ExternalSecret` to inject a Key Vault value into a Kubernetes Secret. Use Workload Identity when the running application needs to authenticate directly to an Azure resource. You can use both when the app has both needs.

Workload Identity is provisioned for the app automatically. The **Add Access** rows are optional and define which external Azure resources that identity can access. Select a resource type before selecting a role; the role list is scoped to the selected resource type. Remove a row if the app no longer needs that permission.

## Monitor and verify

The status modal polls the AKS workflow using a correlation ID and reports progress, success, or failure. A successful workflow means the automation completed; check **AKS Deployed Applications** to confirm the app appears with the expected environment and image. The deployed applications view supports searching by app name, namespace, owner, or image, filtering by environment, and refreshing the results.

If the workflow reports failure, use its message and workflow link to identify the failing step. Common checks include:

- Confirm the image repository and tag exist in ACR and are pullable by the selected AKS environment.
- Confirm the configured port and health check path match the running container.
- Confirm Key Vault secret names exist before merging or completing the generated change.
- Confirm every Secret key referenced by **Secret Env Vars** exists in the Kubernetes Secret expected by the generated workload.
- For Azure resource access, confirm you selected the correct resource type, resource name, and role for the app's managed identity.

## Diagnose deployment requests in Datadog

After deploying an image containing the structured AKS logging updates, search by
the deployment correlation ID from the status modal or API response:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @correlation_id:"DEPLOYMENT-CORRELATION-ID"
```

Use a bounded UTC window and sort oldest first. Follow:

- `aks_deployment_requested` or `aks_deployment_rejected`: accepted configuration or rejected field names (HTTP 400).
- `github_workflow_dispatch_requested` and `github_api_call`: repository, workflow, dispatch timing, success, and upstream HTTP status on failure.
- `aks_deployment_dispatched` or `aks_deployment_failed`: dispatch outcome; a dispatch success is not a completed deployment. Service failures include the `validation` or `dispatch` phase.
- `aks_deployment_status`: polling result, GitHub status/conclusion when available, and lookup duration. `not_found` is not proof of failure; the workflow may not be discoverable yet. `failure` and `error` have error severity.
- `aks_status_request_completed`: links the deployment ID to each polling request's `request_correlation_id`. Use that ID to find the corresponding HTTP completion event.

The deployment POST uses the same correlation ID for workflow dispatch, API response,
and HTTP completion. HTTP events include `status_code` and `duration_ms`; they use
info severity even for HTTP errors, so filter by status code rather than severity.
Workflow inputs, environment variable values, and raw dispatch errors are not logged
by these events. Older deployed images may still log payloads; do not copy those
logs into reports. See the [Datadog investigation runbook](../.runbooks/datadog-logs.md)
for namespace scoping, trace correlation, and safe query procedures.

## Security notes

- Never put credentials in plain **Environment Variables**. Use an existing Kubernetes Secret or Key Vault integration for secret values.
- Prefer Workload Identity over storing Azure credentials in the container.
- Use a specific image tag so you can identify and reproduce the deployed image.
- Check the selected environment and every access grant before submitting. Grants give the app's managed identity access to Azure resources.
