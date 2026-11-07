---
name: service-catalog-metadata
description: "Read, understand, and work with the service-catalog metadata format. Use when: reading application metadata, understanding deployed infrastructure state, designing features that consume or display app data, building API endpoints that serve metadata, or extending the data model. Covers canonical JSON schema, file naming convention, backend read path (GitHub API → infrastructureService → REST API), frontend data shape, and field mapping rules."
argument-hint: "Describe the task: read metadata for an app, design a new field, build an API endpoint, or display app data in the Vue frontend."
user-invocable: true
---

# Service-Catalog Metadata Skill

## What This Skill Covers

This skill gives any agent the complete context needed to:
- Read and interpret existing application metadata files from `service-catalog`
- Understand the canonical JSON schema and file naming rules
- Trace data from storage → GitHub API → backend service → REST endpoint → Vue frontend
- Design new features that extend or consume application metadata
- Add new fields to the schema, the API response, or the frontend display

---

## Storage Location

**Repository**: `Aya-DevOpsTeam/service-catalog` (configured as `GITHUB_SERVICE_REPO` in `.env`)
**Path**: `docs/metadata/`
**File naming**: `<appname>-<environmentname>.json` — one file per deployed app/environment combination

Examples:
- `jobplc-devsand.json`
- `commhub-sand.json`
- `myapi-prod.json`

---

## Canonical JSON Schema

Every metadata file follows this structure:

```json
{
  "project": "jobplc",
  "environment": "devsand",
  "modules": [
    "functionAppSvcWindows"
  ],
  "rbac_pairs": [],
  "timestamp": "2025-07-14T21:59:14Z",
  "meta": {
    "name": "jobplc",
    "description": "jobplc",
    "owner": "Vijay Batham",
    "commit_sha": "649f071b29d6d9eec2c4cba417278735ce4d23a8",
    "deployed_at": "2025-07-14T21:59:14Z",
    "cost_center": "self-service",
    "lifecycle": "Live"
  },
  "commitshas": [
    "649f071b29d6d9eec2c4cba417278735ce4d23a8"
  ],
  "version": "1.0"
}
```

### Field Reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `project` | string | yes | Application name. Matches `<appname>` in filename. Also written as `projectName` in older files. |
| `environment` | string | yes | Environment name (`devsand`, `sand`, `int`, `sint`, `cint`, `stage`, `prod`). Matches `<environmentname>` in filename. |
| `modules` | string[] | yes | List of Terraform module IDs provisioned for this app. See `data/modules.json` for valid values. |
| `rbac_pairs` | array | yes | RBAC assignments. Empty array if none. |
| `timestamp` | ISO 8601 string | yes | When the metadata file was last written. |
| `version` | string | yes | Metadata schema version. Currently `"1.0"`. |
| `commitshas` | string[] | yes | Ordered list of all commit SHAs that have been deployed. Most recent last. |
| `meta.name` | string | yes | Human-readable application name. |
| `meta.description` | string | yes | Short description of the application. |
| `meta.owner` | string | yes | Full name of the owning engineer or team. |
| `meta.commit_sha` | string | yes | SHA of the most recent commit deployed. |
| `meta.deployed_at` | ISO 8601 string | yes | Timestamp of the most recent deployment. |
| `meta.cost_center` | string | yes | Cost center tag. Usually `"self-service"`. |
| `meta.lifecycle` | string | yes | Lifecycle stage: `experimental`, `production`, or `deprecated`. |
| `meta.environment` | string | no | Duplicate of top-level `environment`. Present in some files for convenience. |

### Legacy Field Aliases

Older files may use `projectName` instead of `project`. The backend normalises both — always read with `appData.projectName || appData.project`.

---

## Backend Read Path

### 1. GitHub API Call (`services/githubService.js`)

Authentication uses the Infrastructure GitHub App (`GITHUB_APP_ID` + `GITHUB_INSTALLATION_ID`). The installation covers `Aya-DevOpsTeam/service-catalog`, so **no extra credentials are needed** to read metadata.

```js
// List all files in docs/metadata
const { data: contents } = await githubService.octokit.rest.repos.getContent({
  owner: 'Aya-DevOpsTeam',
  repo: 'service-catalog',
  path: 'docs/metadata'
});

// Read a single metadata file
const { data: fileData } = await githubService.octokit.rest.repos.getContent({
  owner: 'Aya-DevOpsTeam',
  repo: 'service-catalog',
  path: 'docs/metadata/jobplc-devsand.json'
});
const appData = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8'));
```

### 2. Service Layer (`services/infrastructureService.js` → `getInstalledApps()`)

Reads all JSON files in `docs/metadata/`, decodes base64 content, and normalises to an internal shape:

```js
{
  projectName: appData.projectName || appData.project,
  environment: appData.environment,
  owner: appData.owner || appData.meta?.owner,
  createdAt: appData.createdAt || appData.meta?.deployed_at,
  status: appData.status || 'active',
  lifecycle: appData.lifecycle || appData.meta?.lifecycle || 'experimental',
  description: appData.description || appData.meta?.description,
  modules: this._normalizeModules(appData.modules),   // always returns string[]
  age: appData.age || appData.meta?.age || 'Unknown',
  githubUser: appData.githubUser || appData.meta?.githubuser,
  commitSha: appData.commitSha || appData.meta?.commit_sha,
  costCenter: appData.tags?.costCenter || appData.meta?.cost_center
}
```

`_normalizeModules()` handles three input shapes:
- `string[]` → returned as-is
- `Array<{name: string}>` → mapped to `string[]`
- `string` (comma-separated) → split on `", "`

### 3. REST API Endpoint (`routes/api.js`)

`GET /api/installed-apps` (requires auth) returns:

```json
{
  "success": true,
  "data": [
    {
      "name": "jobplc",
      "environment": "devsand",
      "owner": "Vijay Batham",
      "deployedAt": "2025-07-14T21:59:14Z",
      "lifecycle": "Live",
      "status": "active",
      "modules": ["functionAppSvcWindows"],
      "age": "Unknown",
      "description": "jobplc"
    }
  ],
  "correlationId": "cid-1234567890-abc"
}
```

Results are sorted alphabetically by `name`.

---

## Frontend Data Shape (Vue 3 / `srcV2/`)

The Pinia infrastructure store (`srcV2/stores/infrastructure.ts`) holds the API response. Vue components access:

| API field | Display label | Notes |
|---|---|---|
| `name` | Application Name | Used as primary identifier |
| `environment` | Environment | Badge-coloured by env type |
| `lifecycle` | Lifecycle | `experimental` / `production` / `deprecated` |
| `owner` | Owner | Plain text |
| `deployedAt` | Deployed At | Format with `toLocaleDateString()` |
| `modules` | Modules | Rendered as tags/chips |
| `description` | Description | Shown in detail/tooltip |

---

## How To Add a New Field

Follow this pattern when the schema needs a new field (example: `cost_center` surfaced to the frontend):

**Step 1 — Schema**: Add the field to the canonical JSON above (in this SKILL.md) and note which `meta.*` subkey it lives under.

**Step 2 — Service layer** (`services/infrastructureService.js`, `getInstalledApps()`): Add the field to the returned object:
```js
costCenter: appData.tags?.costCenter || appData.meta?.cost_center
```

**Step 3 — API route** (`routes/api.js`, `/installed-apps` handler): Add the field to the `formattedApps` map:
```js
costCenter: app.costCenter || 'self-service'
```

**Step 4 — TypeScript type** (`srcV2/types/infrastructure.types.ts`): Add the field to the `Application` interface.

**Step 5 — Vue component**: Render the field in the appropriate component under `srcV2/components/` or `srcV2/pages/`.

---

## How To Read a Single App's Metadata (Agent Task Pattern)

When an agent needs to read one specific app's metadata (e.g., to validate before generating Terraform):

1. Call `GET /api/installed-apps` — filter client-side by `name` + `environment`
2. OR call the GitHub API directly using the Infrastructure App token:
   ```
   GET /repos/Aya-DevOpsTeam/service-catalog/contents/docs/metadata/{appname}-{env}.json
   ```

**Never call GitHub API directly from Vue frontend.** Always go through the Express API.

---

## Valid Module IDs

Module IDs in the `modules` array map to entries in `data/modules.json`. Current valid values include:

- `storageV2`, `keyvault`, `appServiceWindows`, `appServiceLinux`
- `functionApp`, `functionAppSvcWindows`, `functionAppSvcLinux`
- `serviceBus`, `sqldb`, `appConfiguration`
- `eventGridTopics`, `UserAssignMSI`, `aiFoundry`
- `RBAC`, `vm`, `vmss`

Always validate a new `modules` value against `data/modules.json` before writing metadata.

---

## Valid Lifecycle Values

| Value | Meaning |
|---|---|
| `experimental` | Provisional / exploratory deployment |
| `production` | Deployed and actively used |
| `deprecated` | Scheduled for deletion |

---

## Environment Names

Valid values for the `environment` field (from `data/environments.json`):
`devsand`, `sand`, `dev`, `int`, `sint`, `cint`, `stage`, `prod`, `dr`, `demo`, `hot`, `poc`
