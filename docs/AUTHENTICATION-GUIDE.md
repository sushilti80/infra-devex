# Portal authentication with Microsoft Entra ID

The portal uses Microsoft Entra ID for user sign-in and verifies bearer tokens on
protected API requests. This is separate from the optional Azure OIDC identity
used later by GitHub Actions to plan or apply infrastructure.

You do **not** need Entra ID, an Azure subscription, a GitHub App, or a GitHub
token to generate files locally as described in the [README](../README.md).
To use the authenticated portal, you need an Entra tenant and an app registration
plus a server-side GitHub credential.

## Configure an app registration

1. In Microsoft Entra ID, create an app registration for your installation.
   The application currently expects a single tenant.
2. Record its application (client) ID and directory (tenant) ID.
3. Under **Authentication**, add a **Single-page application** platform and
   register the redirect URL you will use:
   - `http://localhost:3000` for the built frontend served by Express.
   - `http://localhost:5173` for the Vite development server.
4. Under **Expose an API**, configure the application ID URI and expose an API
   permission such as `access_as_user`. Configure and grant the required
   consent for your tenant. The current frontend requests
   `<client-id>/.default` when obtaining its API access token.
5. For a hosted installation, register its exact HTTPS origin as an additional
   SPA redirect URI. Do not use a client secret in the browser.

Your Entra administrator can help with registration permissions and consent.
Creating a portal identity and configuring a deployment subscription are
separate tasks.

## Configure the portal

Copy `.env.example` to `.env` and set your own values:

```dotenv
AZURE_AD_CLIENT_ID=<your-client-id>
AZURE_AD_TENANT_ID=<your-tenant-id>
VITE_ENTRA_CLIENT_ID=<your-client-id>
VITE_ENTRA_TENANT_ID=<your-tenant-id>
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/<your-tenant-id>

GITHUB_SERVICE_REPO=<owner>/<your-infra-devex-repository>
GITHUB_PERSONAL_ACCESS_TOKEN=<your-repository-scoped-token>
```

Keep `.env` and the token private. `VITE_*` values are frontend configuration
and are visible in the browser; never put secrets in them. The GitHub token is
server-side. A configured GitHub App can be used as an alternative to the token.

## Start locally

For a simple single-port run, build the frontend after editing `.env`:

```bash
npm ci --legacy-peer-deps
npm run build:client
npm start
```

The example `.env` uses port `3000`; open `http://localhost:3000`.
Adjust the registered redirect URI if you change the port.

For hot reload, the Vite proxy expects Express on port `3001`:

```bash
# Terminal 1
PORT=3001 npm run dev

# Terminal 2
npm run dev:client
```

Open `http://localhost:5173`. Register that exact origin as an SPA redirect
URI. Restart Vite after changing frontend environment values.

## Troubleshooting

- **Redirect URI mismatch:** Register the exact browser origin and SPA platform,
  including the correct port.
- **401 from the API:** Check the backend client and tenant IDs, the token's
  audience and issuer, and whether the API permission has been consented to.
- **GitHub dispatch fails:** Check the server-side token's repository scope and
  Actions permissions, and confirm the selected workflow is on the default branch.
- **Development API connection fails:** Confirm Express is on port `3001` when
  using Vite; its proxy targets that port.

The clean-install tests do not exercise an actual Entra sign-in. Validate the
registration and consent flow in your own tenant before relying on the portal.
