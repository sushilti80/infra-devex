# Prepare a public installation

## Configure the portal

1. Install dependencies with `npm ci --legacy-peer-deps` and copy `.env.example`
   to `.env`. Never commit the populated file or GitHub private keys.
2. Configure `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and
   `GITHUB_PRIVATE_KEY_PATH` for your Infrastructure GitHub App.
3. Configure `GITHUB_SERVICE_REPO`, `GITHUB_MODULES_REPO`,
   `GITHUB_SELF_SERVICE_REPO`, and optional `GITHUB_INFRA_LIVE_REPO` with your
   `OWNER/REPOSITORY` values. Set up the separate repository using
   [the catalog guide](../service-catalog/README.md).
4. Replace the example environments and empty subscription IDs in
   `data/environments.json` with your own environments. Configure feature flags,
   `data/environmentTiers.json`, and `data/secretBundles.json` consistently.
   The runtime reads the JSON catalog; legacy `AZURE_SUBSCRIPTION_IDS` variables
   are only a fallback when the catalog is unavailable.
5. Configure Microsoft Entra ID using [AUTHENTICATION-GUIDE.md](AUTHENTICATION-GUIDE.md).
   Set the frontend client ID, tenant ID, and authority and backend validation
   settings. Keep authentication enabled on hosted installations.
6. Optional AKS integration needs `AKS_FLUX_REPO`, `AKS_DEFAULT_REGISTRY`,
   `AKS_PRIVATE_ZONES` (a JSON environment-to-DNS-zone map), and your own Flux
   workflows. Code bootstrap needs `GITHUB_CODE_SERVICE_REPO` and a separate Code
   GitHub App using `GITHUB_CODE_PRIVATE_KEY_PATH`. Neither is the infrastructure
   service-catalog repository.
7. Configure optional Jira, observability, SOPS, CI service connections, and secrets
   for your own installation. Replace placeholder CODEOWNERS with your maintainers.

## Check locally

```bash
npm run check:public-source
npm run type-check
npm test
npm run test:integration
```

The public-source check catches known organization markers and populated subscription
defaults. It is not a secret scanner or proof that all confidential information is gone.
Run your approved secret scanner and manually review docs, fixtures, screenshots,
workflow inputs, dependency licenses, metadata examples, and Git history as well.

## Publication gates

- Obtain the source owner's written permission to release the portal, copied catalog
  workflows, helpers, and any other owned assets. Possession of the source is not permission.
- Choose an approved open-source license and add its license text. The package currently
  declares ISC; that declaration alone does not establish permission or cover copied code.
- Publish a reviewed clean source export into a new repository, or have an authorized
  maintainer sanitize **all** branches, tags, and history before changing visibility.
  This change does not rewrite history, delete remote repositories, or create a public repo.
- Do not export `.git`, populated `.env` files, keys, logs, generated Graphify output,
  test reports, local build artifacts, deployed catalog metadata, or Terraform state.
- Rotate any credentials that were ever exposed. Removing their current values does
  not revoke them or remove them from history.
- Review and harden copied workflows before production use, including input handling,
  action/tool pinning, permissions, backend locking, plan/apply approvals, and destroy gates.
  No live Azure deployment or cost/security certification was performed for this cleanup.