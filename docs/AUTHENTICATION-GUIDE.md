# Authentication Guide - Microsoft Entra ID

Complete guide for setting up and using Microsoft Entra ID authentication in the Self-Service Infrastructure Catalog.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Local Development](#local-development)
- [Production Deployment](#production-deployment)
- [User Guide](#user-guide)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)

---

## Overview

### Authentication Architecture

The application uses **Microsoft Entra ID** (formerly Azure Active Directory) for authentication with the following components:

**Frontend (Vue 3 + MSAL.js):**
- Single-page application using `@azure/msal-browser`
- OAuth 2.0 Authorization Code Flow with PKCE (no client secret needed)
- Redirect-based login (more reliable than popup)
- Automatic token refresh (silent renewal)
- Session persistence in localStorage

**Backend (Express + JWT):**
- JWT token validation on protected API endpoints
- RS256 signature verification using Azure AD public keys (JWKS)
- Token audience validation (ensures token is for our API)
- User identity extraction (email, name, tenant)
- Request correlation for audit logging

**Security Features:**
- ✅ No client secrets (PKCE protects against token interception)
- ✅ Short-lived tokens (1 hour expiration)
- ✅ Automatic renewal (no user re-login required)
- ✅ Secure token storage (httpOnly cookies in production recommended)
- ✅ Audience validation (prevents token reuse across apps)
- ✅ Signature verification (prevents token tampering)

---

## Prerequisites

Before starting, ensure you have:

1. **Azure Subscription** with permissions to create app registrations
2. **Entra ID Access** (Azure Active Directory capabilities)
3. **Admin Consent** (or ability to grant user consent for API access)
4. **Azure CLI** installed for testing: `az login`

---

## Initial Setup

### Step 1: Create Entra ID App Registration

1. **Navigate to Azure Portal:**
   - Go to https://portal.azure.com
   - Search for "Entra ID" or "Azure Active Directory"
   - Click **App registrations** in the left sidebar

2. **Create New Registration:**
   - Click **+ New registration**
   - **Name**: `Self-Service Infrastructure Catalog` (or your preferred name)
   - **Supported account types**:
     - Select **"Accounts in this organizational directory only (Single tenant)"**
   - **Redirect URI**: Leave empty for now (we'll add it later)
   - Click **Register**

3. **Copy Important Values:**
   After registration, you'll see the Overview page. Copy these values:
   - **Application (client) ID**: e.g., `ee62dfaa-bd92-4f1d-888d-16e7e81f8e18`
   - **Directory (tenant) ID**: e.g., `c32ce235-4d9a-4296-a647-a9edb2912ac9`

   You'll need these for your `.env` file.

---

### Step 2: Configure Application ID URI

1. In your app registration, click **Expose an API** in the left sidebar
2. Click **Add** next to "Application ID URI"
3. Use the default format: `api://{YOUR_CLIENT_ID}`
   - Example: `api://ee62dfaa-bd92-4f1d-888d-16e7e81f8e18`
4. Click **Save**

**Why this matters:** The Application ID URI uniquely identifies your API. When the frontend requests a token for your backend, it includes this identifier, ensuring tokens can't be used for other applications.

---

### Step 3: Add API Scope

1. Under **Expose an API**, click **+ Add a scope**
2. Fill in the following:

   **Scope configuration:**
   - **Scope name**: `access_as_user`
   - **Who can consent**: **Admins and users**
   - **Admin consent display name**: `Access application as user`
   - **Admin consent description**: `Allows the app to access the self-service infrastructure catalog as the signed-in user`
   - **User consent display name**: `Access the app as you`
   - **User consent description**: `Allows you to use the self-service infrastructure catalog`
   - **State**: **Enabled**

3. Click **Add scope**

**Result:** Your API now has a scope: `api://{CLIENT_ID}/access_as_user`

**Note:** We use minimal scopes (just `access_as_user`) to simplify consent. More granular scopes can be added later for different permission levels.

---

### Step 4: Configure Authentication Platform

1. Click **Authentication** in the left sidebar
2. Click **+ Add a platform**
3. Select **Single-page application**

4. **Add Redirect URIs** for each environment:

   **Local Development:**
   - `http://localhost:3001` (production build mode)
   - `http://localhost:5174` (Vite dev server with HMR)

   **Staging/Production:**
   - `https://your-staging-url.azurewebsites.net`
   - `https://self-service-infra.yourdomain.com`
   - Add any other domains where the app will be hosted

5. **Front-channel logout URL**: Leave empty (optional feature)

6. **Implicit grant and hybrid flows**:
   - ❌ **DO NOT check** "Access tokens"
   - ❌ **DO NOT check** "ID tokens"
   - The app uses Authorization Code Flow with PKCE (modern, secure)

7. Click **Configure**

---

### Step 5: Grant Initial Consent

For the application to work, users need to consent to accessing the API. For initial testing, grant consent via Azure CLI:

```bash
# Login with Azure CLI (if not already logged in)
az login

# Grant consent by requesting a token for your API
az account get-access-token --resource {YOUR_CLIENT_ID}

# Example:
az account get-access-token --resource ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
```

This command:
1. Triggers the consent flow for your user
2. Grants permission to access the API
3. Returns an access token (confirms consent worked)

**For production deployments**, you can:
- **Admin consent**: Have an admin pre-approve the app for all users
- **First-run consent**: Users will see a consent screen on their first login

---

## Local Development

### Environment Configuration

Create/update `.env` in the project root:

```bash
# Microsoft Entra ID - Backend JWT Validation
AZURE_AD_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
AZURE_AD_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9

# Microsoft Entra ID - Frontend MSAL Configuration
VITE_ENTRA_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18
VITE_ENTRA_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/c32ce235-4d9a-4296-a647-a9edb2912ac9
```

**Replace the GUIDs** with your actual Client ID and Tenant ID from Step 1.

---

### Running the Application

#### Option 1: Production Build Mode (Recommended for Auth Testing)

```bash
# Build Vue frontend
npm run build:client

# Start Express server with built frontend
USE_VUE=true npm start
```

Open: http://localhost:3001

#### Option 2: Development Mode with HMR

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend with HMR
npm run dev:client
```

Open: http://localhost:5174

**Note:** For HMR mode, ensure `http://localhost:5174` is added as a redirect URI in your app registration.

---

### Testing Authentication

1. **Open the application** in your browser
2. **Click "Login with Entra ID"** button in the header
3. **Redirect to Microsoft login**:
   - You'll be redirected to `login.microsoftonline.com`
   - Sign in with your work account email
4. **After authentication**:
   - Redirected back to your app
   - Page reloads
   - Your name and email appear in the header
5. **Test API calls**:
   - Navigate to "Installed Apps"
   - Data should load without 401 errors
6. **Check browser console** (F12):
   ```
   [Auth Store] Found existing account: your.email@domain.com
   [Auth Store] Session restored with API token
   [App] Application initialized
   ```

7. **Check backend logs** (terminal running npm start):
   ```
   Token validated for user: your.email@domain.com
   [correlation-id] Authenticated request from: your.email@domain.com
   [correlation-id] User your.email@domain.com fetching installed applications
   ```

---

## Production Deployment

### Kubernetes Configuration

Create a Kubernetes secret with Entra ID credentials:

```bash
kubectl create secret generic entra-id-config \
  --from-literal=AZURE_AD_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18 \
  --from-literal=AZURE_AD_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9 \
  --from-literal=VITE_ENTRA_CLIENT_ID=ee62dfaa-bd92-4f1d-888d-16e7e81f8e18 \
  --from-literal=VITE_ENTRA_TENANT_ID=c32ce235-4d9a-4296-a647-a9edb2912ac9 \
  --from-literal=VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/c32ce235-4d9a-4296-a647-a9edb2912ac9
```

### Update Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: self-service-infra
spec:
  template:
    spec:
      containers:
      - name: app
        image: yourregistry.azurecr.io/self-service-infra:latest
        envFrom:
        - secretRef:
            name: entra-id-config
        env:
        - name: USE_VUE
          value: "true"
        - name: NODE_ENV
          value: "production"
```

### Update Redirect URIs

Before deploying, add your production URL to the app registration:

1. Go to Azure Portal → Your App Registration → **Authentication**
2. Under **Single-page application**, click **Add URI**
3. Add: `https://your-production-domain.com`
4. Click **Save**

---

## User Guide

### Logging In

1. Click **"Login with Entra ID"** button in the application header
2. Redirect to Microsoft login page
3. Enter your work email and password
4. Complete any multi-factor authentication (MFA) prompts
5. Redirected back to the application
6. Your name and email appear in the header

### Session Persistence

- **Automatic**: Your session persists across page refreshes
- **Duration**: Tokens valid for 1 hour, automatically renewed
- **Logout**: Click your name → **Logout** to end session

### Using the Application

Once logged in:
- ✅ All features accessible (Custom Infrastructure, Templates, AKS Deploy)
- ✅ API calls automatically authenticated
- ✅ Your actions logged with your email in backend logs
- ✅ Token refreshes automatically (no interruption)

---

## Troubleshooting

### Error: "Cross-origin token redemption is permitted only for 'Single-Page Application'"

**Cause**: Redirect URI configured as "Web" instead of "Single-page application"

**Fix**:
1. Go to app registration → **Authentication**
2. Remove the URI from "Web" section (if present)
3. Add it under **Single-page application** section
4. Save

---

### Error: "AADSTS90009: Application is requesting a token for itself"

**Cause**: Token scopes use `api://GUID/.default` format, but Azure requires `GUID/.default` when app requests token for itself

**Fix**: Already fixed in code. Token scopes use `{CLIENT_ID}/.default` format.

**Verify** in `srcV2/services/authService.ts`:
```typescript
export const tokenRequest = {
  scopes: [`${import.meta.env.VITE_ENTRA_CLIENT_ID}/.default`]
}
```

---

### Error: 401 Unauthorized on API Calls

**Possible causes:**

1. **Token has wrong audience**:
   - Backend expects: `api://ee62dfaa-bd92-4f1d-888d-16e7e81f8e18`
   - Token might have: `https://graph.microsoft.com` (wrong)

   **Debug**: Check browser console for token acquisition logs

2. **Environment variables mismatch**:
   - Ensure `AZURE_AD_CLIENT_ID` (backend) matches `VITE_ENTRA_CLIENT_ID` (frontend)
   - Check `.env` file has correct values

3. **Token not attached to request**:
   - Check Network tab → Request Headers → Should have `Authorization: Bearer ...`

   **Debug**: Open DevTools → Network tab → Click failed request → Headers

---

### Login Redirect Not Working

**Symptoms**: After login, redirected to wrong URL or error page

**Fix**:
1. Check redirect URI matches exactly (case-sensitive, no trailing slash unless registered that way)
2. Ensure URI is registered as **SPA** platform
3. Check browser console for MSAL errors

**Verify registered redirect URIs**:
```bash
az ad app show --id {CLIENT_ID} --query "spa.redirectUris"
```

---

### Session Not Persisting After Page Refresh

**Cause**: localStorage disabled or cleared

**Fix**:
1. Ensure browser allows localStorage (check Privacy settings)
2. Check browser console for errors accessing localStorage
3. Verify MSAL cache in DevTools → Application → Local Storage → Look for keys starting with `msal.`

**Debug**:
```javascript
// Run in browser console
Object.keys(localStorage).filter(k => k.includes('msal'))
```

Should show several `msal.*` keys. If empty, session not saved.

---

### Token Expired and Not Refreshing

**Expected behavior**: Tokens refresh automatically every ~50 minutes

**If getting 401 after 1 hour**:
1. Check browser console for token refresh errors
2. Verify network connectivity (silent refresh uses background request)
3. Check if user consent is still valid

**Manual token refresh**:
```javascript
// Run in browser console
const authStore = useAuthStore();
await authStore.acquireToken(true); // Force refresh
console.log('Token refreshed');
```

---

### User Email Not Appearing in Backend Logs

**Symptoms**: Logs show `[correlation-id]` but no user email

**Possible causes:**
1. JWT not being validated (missing `requireAuth` middleware)
2. Token doesn't contain `preferred_username` claim

**Check backend logs for**:
```
Token validated for user: your.email@domain.com
```

If this doesn't appear, check `utils/jwtValidator.js` is correctly extracting claims.

---

## Security Considerations

### Token Storage

**Current**: localStorage (suitable for development/internal tools)

**For high-security production**:
- Consider using httpOnly cookies (requires backend changes)
- Implement token rotation
- Add refresh token support

### Token Validation

Backend validates:
- ✅ Signature (RS256 using Azure AD public keys)
- ✅ Audience (`api://{CLIENT_ID}` or `{CLIENT_ID}`)
- ✅ Issuer (Microsoft Entra ID)
- ✅ Expiration (1 hour default)
- ✅ Not-before time

### Recommended Practices

1. **Use HTTPS** in production (TLS 1.2+)
2. **Enable audit logging** for authentication events
3. **Monitor failed login attempts**
4. **Implement rate limiting** on auth endpoints
5. **Review app permissions** regularly
6. **Rotate secrets** if using client secrets (we don't currently)

---

## Advanced Configuration

### Role-Based Access Control (RBAC)

To add roles:

1. **Define App Roles** in app registration:
   - Go to **App roles** → Create
   - Add roles: `Admin`, `User`, `Viewer`

2. **Assign Users to Roles**:
   - Go to **Enterprise Applications** → Your app → **Users and groups**
   - Assign users to roles

3. **Access roles in backend**:
   ```javascript
   // In middleware/auth.js
   const roles = req.user.roles || []; // Extracted from token

   // Check if user has admin role
   if (!roles.includes('Admin')) {
     return res.status(403).json({ error: 'Forbidden' });
   }
   ```

4. **Use role middleware**:
   ```javascript
   // Protect admin-only endpoint
   router.post('/admin/settings', requireAuth, requireRole('Admin'), async (req, res) => {
     // Only admins can access
   });
   ```

---

### Multi-Tenant Support

To support multiple Azure AD tenants:

1. Change app registration to **multi-tenant**:
   - Supported account types: "Accounts in any organizational directory"

2. Update authority in MSAL config:
   ```typescript
   authority: 'https://login.microsoftonline.com/common'
   ```

3. Backend validates tokens from any tenant:
   - Verify issuer is Microsoft (not specific tenant)
   - Extract tenant ID from token claims

---

## Testing

Automated authentication coverage lives in `tests/integration/` and `tests/smoke/` (run via `npm run test:integration` / `npm run test:smoke`). The standalone `test-auth-e2e.js` manual script has been retired.

Manual testing checklist: [docs/TESTING-CHECKLIST.md](./TESTING-CHECKLIST.md)

---

## Additional Resources

- [Microsoft Entra ID Documentation](https://learn.microsoft.com/entra/identity/)
- [MSAL.js Documentation](https://github.com/AzureAD/microsoft-authentication-library-for-js)
- [OAuth 2.0 Authorization Code Flow with PKCE](https://oauth.net/2/pkce/)
- [Azure AD Token Reference](https://learn.microsoft.com/entra/identity-platform/access-tokens)

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section above
2. Review [Testing Checklist](./TESTING-CHECKLIST.md)
3. Check backend logs for detailed error messages
4. Check browser console for frontend errors
5. Contact your Azure AD administrator for account/permissions issues
