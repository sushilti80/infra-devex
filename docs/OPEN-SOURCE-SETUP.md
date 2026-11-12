# Prepare a public installation

Infra DevEx uses one repository for the portal, workflow, catalog, generated IaC,
and metadata. Follow the [README](../README.md) for local or GitHub Actions
generation without Azure credentials. The portal can use a repository-scoped
fine-grained personal access token or an optional GitHub App; it currently uses
Entra ID for portal user sign-in. Configure the customer subscription, remote
state, deployment identities and protected environments only if enabling Azure
execution; see [deployment setup](CATALOG-SETUP.md).

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