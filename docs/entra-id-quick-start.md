# Entra ID Integration - Quick Start Guide (Stateless JWT)

**Created**: November 2025  
**Updated**: January 30, 2026 (Vue 3 context)  
**Related Epic**: [DSO-1893 - Vue.js Migration](https://example.atlassian.net/browse/DSO-1893)
**Target**: srcV2/ (Vue 3 + TypeScript)

⚠️ **Important**: This integration targets the **new Vue 3 implementation** in srcV2/ directory. See [Vue.js Migration Context](./entra-id-integration-plan.md#vuejs-migration-context) for details.

---

## 🚀 Quick Implementation Steps

### 1. Azure Portal Setup (20 minutes)
1. Go to Azure Portal → Entra ID → App Registrations
2. Create new registration: "Self-Service Infrastructure Catalog"
3. **Platform**: Single-page application (SPA)
4. Add Redirect URI: `https://your-domain` (or `http://localhost:3000` for dev)
5. **No client secret needed** for public SPA
6. Add API permissions: `User.Read`, `email`, `profile`, `openid`
7. Grant admin consent
8. (Optional) Configure token claims: Add `email`, `groups` optional claims

### 2. Install Dependencies (1 minute)
```bash
# Backend only - 1 package (jsonwebtoken already exists!)
npm install jwks-rsa

# Frontend - MSAL.js via CDN (no npm install)
```

### 3. Environment Variables (2 minutes - Simplified!)
Add to `.env`:
```bash
# Only 2 variables needed!
AZURE_AD_CLIENT_ID=<from-azure-portal>
AZURE_AD_TENANT_ID=<from-azure-portal>

# NO client secret - public SPA
# NO session secret - stateless
# NO redirect URIs - MSAL handles
```

### 4. Create Configuration Files (Extremely Simple)
Copy these files from the main implementation plan:
- `config/auth.js` (Entra ID config - 20 lines)
- `utils/jwtValidator.js` (Direct JWT validation - 60 lines)
- `middleware/auth.js` (Auth middleware - 60 lines)

**Files NOT needed:**
- ❌ config/passport.js (no Passport - direct JWT!)
- ❌ config/session.js (no sessions)
- ❌ routes/auth.js (MSAL handles routes)

### 5. Update server.js (Minimal - 5 lines!)
Add after existing middleware:
```javascript
const { requireAuth } = require('./middleware/auth');

// Update CORS for Authorization header
app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Protect API routes
app.use('/api', requireAuth, apiRoutes);

// Static files remain public
app.use(express.static('public'));
```

**No Passport initialization needed. No session middleware. Just apply `requireAuth` to API routes!**

### 6. Update Frontend (MSAL.js)
Create `public/js/auth.js` with MSAL configuration:
```javascript
const msalConfig = {
  auth: {
    clientId: '<YOUR_CLIENT_ID>',
    authority: 'https://login.microsoftonline.com/<YOUR_TENANT_ID>',
    redirectUri: window.location.origin,
  },
};

const msalInstance = new msal.PublicClientApplication(msalConfig);
// ... MSAL logic (see implementation plan)
```

Add to `public/index.html`:
```html
<script src="https://alcdn.msauth.net/browser/3.0.0/js/msal-browser.min.js"></script>
<script src="js/auth.js"></script>
```

Update `public/js/app.js` to add Bearer tokens:
```javascript
async function fetchWithAuth(url, options = {}) {
  const token = await Auth.getToken();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  });
}
```

### 7. Test Locally
```bash
npm start
# Visit http://localhost:3000
# MSAL triggers Microsoft login popup
# After auth, token stored in browser
# API calls include Bearer token
```

### 8. Deploy to Kubernetes (Simplified)
```bash
# Update secrets (only 2 values!)
kubectl create secret generic infra-catalog-auth-secrets \
  --from-literal=AZURE_AD_CLIENT_ID=xxx \
  --from-literal=AZURE_AD_TENANT_ID=xxx

# Apply changes
kubectl apply -f kubernetes/deployment.yaml
```

## 📋 Pre-Flight Checklist

### Before Starting
- [ ] Have Azure Portal access with appropriate permissions
- [ ] Have production domain name ready
- [ ] Have SSL certificate configured
- [ ] Have database credentials for session store
- [ ] Backup current working code

### Azure Portal Configuration
- [ ] App registration created
- [ ] Platform: Single-page application (SPA)
- [ ] Redirect URI configured (your domain)
- [ ] API permissions added and granted
- [ ] (Optional) Token optional claims configured (`email`, `groups`)
- [ ] (Optional) Security groups created in Entra ID

### Code Implementation (Extremely Simple)
- [ ] Backend dependencies installed (1 package: jwks-rsa)
- [ ] Configuration files created (3 files total)
- [ ] Middleware implemented (direct JWT validation)
- [ ] Frontend MSAL.js added
- [ ] auth.js wrapper created
- [ ] server.js modified (5 lines!)

### Testing (Stateless)
- [ ] MSAL login popup/redirect works
- [ ] Protected API routes require Bearer token
- [ ] Token auto-refresh works
- [ ] User info extracted from token
- [ ] User email appears in GitHub PRs

### Deployment (Simplified)
- [ ] Environment variables set (2 vars)
- [ ] Kubernetes secrets created (2 values)
- [ ] Deployment manifest updated
- [ ] Staging deployment successful
- [ ] User identity captured in logs/PRs

## 🔑 Key URLs

### Development
- App: `http://localhost:3000`
- MSAL Redirect URI: `http://localhost:3000`
- Login: Automatic MSAL popup/redirect

### Production
- App: `https://your-domain.com`
- MSAL Redirect URI: `https://your-domain.com`
- Login: Automatic MSAL popup/redirect

### Azure Portal
- App Registrations: `https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps`
- Entra ID Overview: `https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`

## 🛠️ Common Commands (Stateless)

### Test API with Bearer Token
```bash
# Get token from browser DevTools > Application > Local Storage
# Copy access token value

curl -v -H "Authorization: Bearer <your-token>" \
  http://localhost:3000/api/modules
```

### Decode JWT Token (Debugging)
```bash
# Use https://jwt.io
# Or decode manually:
node -e "console.log(JSON.parse(Buffer.from('eyJ...'.split('.')[1], 'base64')))"
```

### Test Token Validation
```bash
# Valid token -> 200
curl -X POST http://localhost:3000/api/custom \
  -H "Authorization: Bearer <valid-token>" \
  -H "Content-Type: application/json" \
  -d '{"modules": ["vpc"]}'

# No token -> 401
curl -v http://localhost:3000/api/custom
```

### View Logs
```bash
# Kubernetes
kubectl logs -f deployment/infra-catalog -n <namespace>

# Local
tail -f logs/app.log
```

## ⚠️ Common Issues (Stateless)

### "Invalid token" or 401 errors
- **Cause**: Token expired, invalid, or missing
- **Fix**: Check token expiration at jwt.io, ensure `Authorization: Bearer <token>` header, verify MSAL token refresh

### Token not included in requests
- **Cause**: `fetchWithAuth()` not used or MSAL not initialized
- **Fix**: Verify all API calls use `fetchWithAuth()`, check browser console for MSAL errors

### MSAL popup blocked
- **Cause**: Browser blocking popups
- **Fix**: Use redirect flow (`loginRedirect()`) instead of popup, or whitelist domain

### "Platform mismatch" in Azure Portal
- **Cause**: App registered as "Web" instead of "SPA"
- **Fix**: Change platform to "Single-page application" in Azure Portal

### User email not in token claims
- **Cause**: Optional claims not configured
- **Fix**: Add `email` optional claim in Azure Portal → Token configuration

## 📞 Support

For detailed implementation steps, see: `docs/entra-id-integration-plan.md`

For security guidelines, see: Section 7 of implementation plan

For testing procedures, see: Section 8 of implementation plan
