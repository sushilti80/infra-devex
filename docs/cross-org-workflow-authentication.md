# Cross-Organization Workflow Authentication

## Problem Statement

When a GitHub Actions workflow needs to clone a private repository from another organization (e.g., `AyaHealthcare/ApiTemplate`), it encounters authentication issues because the default `GITHUB_TOKEN` only has access to the repository where the workflow is running.

### Error Example
```
fatal: could not read Username for 'https://github.com': No such device or address
Error: Process completed with exit code 128.
```

## Solution Overview

Use a **GitHub App** to generate installation access tokens that can be used across organizations. The backend automatically:

1. Generates an installation access token from the code deployment GitHub App
2. Stores it as a repository secret (`CODE_DEPLOYMENT_TOKEN`)
3. Triggers the workflow, which uses this token for git operations

## Architecture

```
┌─────────────────────┐
│  Self-Service UI    │
│  (User triggers)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Backend API        │
│  /add-code-repo     │
└──────────┬──────────┘
           │
           ├─────────────────────────────────┐
           │                                 │
           ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────┐
│  GitHub App         │         │  GitHub API         │
│  (Code Deployment)  │         │  Actions Secret     │
│                     │         │  CODE_DEPLOYMENT_   │
│  Generate Token ────┼────────▶│  TOKEN (created)    │
└─────────────────────┘         └──────────┬──────────┘
                                           │
                                           ▼
                                ┌─────────────────────┐
                                │  Workflow Triggered │
                                │  create-app.yml     │
                                └──────────┬──────────┘
                                           │
                                           ▼
                                ┌─────────────────────┐
                                │  Uses secret token  │
                                │  to clone private   │
                                │  template repo      │
                                └─────────────────────┘
```

## Implementation Details

### Backend Changes

#### 1. New Methods in `githubService.js`

**`generateInstallationToken(useCodeApp = true)`**
- Generates a short-lived installation access token
- Uses the code deployment GitHub App by default
- Token expires after 1 hour (GitHub's default)
- Returns: String token for authentication

**`createOrUpdateRepoSecret(repo, secretName, secretValue, useCodeApp = true)`**
- Encrypts and stores a secret in the target repository
- Uses libsodium (tweetnacl) for encryption
- Updates existing secret or creates new one
- Parameters:
  - `repo`: Target repository (e.g., `AyaHealthcare/self-service-catalog`)
  - `secretName`: Name of the secret (e.g., `CODE_DEPLOYMENT_TOKEN`)
  - `secretValue`: The installation token
  - `useCodeApp`: Whether to use code deployment app (default: true)

#### 2. Updated `/add-code-repo` Endpoint

The endpoint now:
1. Generates installation token from code deployment GitHub App
2. Stores token as `CODE_DEPLOYMENT_TOKEN` secret in target repo
3. Triggers the workflow (which can now use the secret)

```javascript
// Step 1: Generate installation access token
const installationToken = await githubService.generateInstallationToken(true);

// Step 2: Store token as repository secret
await githubService.createOrUpdateRepoSecret(
  'AyaHealthcare/self-service-catalog',
  'CODE_DEPLOYMENT_TOKEN',
  installationToken,
  true
);

// Step 3: Trigger workflow (which uses secrets.CODE_DEPLOYMENT_TOKEN)
await githubService.triggerWorkflow(...);
```

### Workflow Changes

Update the `create-app.yml` workflow in `AyaHealthcare/self-service-catalog`:

#### Key Changes:

1. **Checkout step** - Use `CODE_DEPLOYMENT_TOKEN` instead of `GITHUB_TOKEN`:
```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    token: ${{ secrets.CODE_DEPLOYMENT_TOKEN }}
```

2. **Clone template** - Authenticate with the token:
```yaml
- name: Clone template repository
  run: |
    git clone https://x-access-token:${{ secrets.CODE_DEPLOYMENT_TOKEN }}@github.com/${{ github.event.inputs.template_repo }}.git /tmp/TemplateRepo
  env:
    GIT_TERMINAL_PROMPT: 0
```

3. **Push changes** - Use token for pushing:
```yaml
- name: Create branch and commit changes
  run: |
    # ... git commands ...
    git push origin "$BRANCH_NAME"
  env:
    GITHUB_TOKEN: ${{ secrets.CODE_DEPLOYMENT_TOKEN }}
```

4. **Create PR** - Use token for PR creation:
```yaml
- name: Create Pull Request
  run: |
    gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base main --head "$BRANCH_NAME"
  env:
    GITHUB_TOKEN: ${{ secrets.CODE_DEPLOYMENT_TOKEN }}
```

See complete example: [`docs/create-app-workflow-example.yml`](./create-app-workflow-example.yml)

## Security Considerations

### Token Lifecycle
- **Generated**: When workflow is triggered via UI
- **Stored**: As encrypted repository secret
- **Expires**: After 1 hour (GitHub's default)
- **Refreshed**: On each workflow trigger

### Permissions
The GitHub App must have:
- **Repository access**: Both template repo and target repo
- **Permissions**:
  - Contents: Read & Write (for cloning and pushing)
  - Pull Requests: Read & Write (for PR creation)
  - Secrets: Write (for storing the token)

### Best Practices
1. ✅ Token is regenerated on each workflow trigger (always fresh)
2. ✅ Token is encrypted when stored as a secret
3. ✅ Token has minimal required permissions
4. ✅ Token auto-expires after 1 hour
5. ✅ Audit trail: All operations logged with correlation IDs

## Troubleshooting

### Token Not Working
- Check GitHub App is installed in both organizations
- Verify installation ID is correct in `.env`
- Ensure private key file is readable
- Check GitHub App permissions

### Secret Not Created
- Verify GitHub App has "Secrets: Write" permission
- Check repository exists and is accessible
- Review backend logs for encryption errors

### Clone Still Failing
- Confirm workflow is using `secrets.CODE_DEPLOYMENT_TOKEN`
- Check token hasn't expired (should be fresh)
- Verify template repository is accessible by GitHub App

## Dependencies

New npm packages required:
```bash
npm install tweetnacl tweetnacl-util
```

## Environment Variables

Required in `.env`:
```bash
# Code Deployment GitHub App
CODE_DEPLOYMENT_APP_ID=123456
CODE_DEPLOYMENT_INSTALLATION_ID=12345678
CODE_DEPLOYMENT_PRIVATE_KEY_PATH=./code-deployment-app-private-key.pem
```

## Testing

### Test Token Generation
```bash
curl -X POST http://localhost:3001/api/add-code-repo \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "test-app",
    "environment": "dev",
    "templateRepo": "AyaHealthcare/ApiTemplate",
    "jiraNumber": "PROJ-123"
  }'
```

### Verify Secret Created
1. Go to `https://github.com/AyaHealthcare/self-service-catalog/settings/secrets/actions`
2. Verify `CODE_DEPLOYMENT_TOKEN` exists
3. Check "Updated" timestamp matches workflow trigger time

### Test Workflow
1. Trigger workflow from UI
2. Monitor workflow run: `https://github.com/AyaHealthcare/self-service-catalog/actions`
3. Check "Clone template repository" step succeeds
4. Verify template contents copied to new folder

## Benefits

✅ **Secure**: Tokens auto-expire, encrypted storage  
✅ **Automated**: No manual token management  
✅ **Scalable**: Works across multiple organizations  
✅ **Auditable**: Full correlation ID tracking  
✅ **Reliable**: Fresh token on each run  

## Alternative Approaches (Not Recommended)

### Personal Access Token (PAT)
- ❌ Tied to individual user account
- ❌ No expiration management
- ❌ Broader permissions than needed
- ❌ Manual rotation required

### Deploy Keys
- ❌ Per-repository setup required
- ❌ Read-only by default
- ❌ Manual management for multiple repos

### GitHub App (Current Solution)
- ✅ Organization-level authentication
- ✅ Auto-expiring tokens
- ✅ Granular permissions
- ✅ Automated token generation
