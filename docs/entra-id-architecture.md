# Entra ID Integration - Architecture Diagrams

**Created**: November 2025  
**Related Epic**: [DSO-1893 - Vue.js Migration](https://ayadev.atlassian.net/browse/DSO-1893)  
**Note**: Architecture diagrams are technology-agnostic and apply to both backend and frontend implementations.

---

## Authentication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTRA ID AUTHENTICATION FLOW                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐                                                      ┌──────────┐
│          │                                                      │          │
│  Browser │                                                      │  Entra   │
│  Client  │                                                      │    ID    │
│          │                                                      │          │
└────┬─────┘                                                      └────┬─────┘
     │                                                                 │
     │  1. GET /                                                       │
     │───────────────────────┐                                         │
     │                       │                                         │
     │              ┌────────▼────────┐                                │
     │              │                 │                                │
     │              │  Express Server │                                │
     │              │  Auth Middleware│                                │
     │              │                 │                                │
     │              └────────┬────────┘                                │
     │                       │                                         │
     │  2. 302 Redirect      │                                         │
     │     to /login.html    │                                         │
     │◄──────────────────────┘                                         │
     │                                                                 │
     │  3. GET /login.html                                             │
     │───────────────────────┐                                         │
     │                       │                                         │
     │              ┌────────▼────────┐                                │
     │              │  Static Server  │                                │
     │              │  (login.html)   │                                │
     │              └────────┬────────┘                                │
     │                       │                                         │
     │  4. Login Page HTML   │                                         │
     │◄──────────────────────┘                                         │
     │                                                                 │
     │  5. User clicks "Sign in with Microsoft"                        │
     │                                                                 │
     │  6. GET /auth/login                                             │
     │───────────────────────┐                                         │
     │                       │                                         │
     │              ┌────────▼────────┐                                │
     │              │  Passport.js    │                                │
     │              │  OIDC Strategy  │                                │
     │              └────────┬────────┘                                │
     │                       │                                         │
     │  7. 302 Redirect to   │                                         │
     │     Entra ID          │                                         │
     │◄──────────────────────┘                                         │
     │                                                                 │
     │  8. Redirect to login.microsoftonline.com                       │
     │─────────────────────────────────────────────────────────────────►
     │                                                                 │
     │  9. User authenticates (enters credentials, MFA, etc.)          │
     │◄────────────────────────────────────────────────────────────────┤
     │                                                                 │
     │  10. Auth code callback                                         │
     │     POST /auth/callback?code=xxx                                │
     │─────────────────────────────────────────────────────────────────►
     │                                                                 │
     │              ┌─────────────────┐                                │
     │              │  Passport.js    │  11. Exchange code for tokens  │
     │              │  OIDC Strategy  │────────────────────────────────►
     │              └────────┬────────┘                                │
     │                       │         12. Return access token + user  │
     │                       │◄────────────────────────────────────────┘
     │                       │  
     │              ┌────────▼────────┐  
     │              │  Session Store  │  13. Create session  
     │              │  (SQL Database) │  
     │              └────────┬────────┘  
     │                       │  
     │  14. Set session      │  
     │      cookie           │  
     │◄──────────────────────┘  
     │  
     │  15. 302 Redirect to /  
     │◄──────────────────────────────────────────────────────────────  
     │  
     │  16. GET / (with session cookie)  
     │───────────────────────┐  
     │                       │  
     │              ┌────────▼────────┐  
     │              │  Auth Middleware│  17. Verify session  
     │              │  (requireAuth)  │  
     │              └────────┬────────┘  
     │                       │         18. Load session from DB  
     │              ┌────────▼────────┐  
     │              │  Session Store  │  
     │              │  (SQL Database) │  
     │              └────────┬────────┘  
     │                       │  
     │  19. Serve index.html │  
     │◄──────────────────────┘  
     │  
     │  20. Load user info  
     │     GET /auth/user  
     │───────────────────────┐  
     │                       │  
     │  21. Return user data │  
     │◄──────────────────────┘  
     │  
     │  22. Update UI with  
     │      user dropdown  
     │  
     ▼  
  (User is now authenticated and can use the app)
```

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SYSTEM COMPONENTS                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │              │  │              │  │              │  │              │   │
│  │  index.html  │  │ login.html   │  │   app.js     │  │   auth.js    │   │
│  │              │  │              │  │              │  │              │   │
│  │  (Main UI)   │  │ (Login Page) │  │ (App Logic)  │  │ (Auth Utils) │   │
│  │              │  │              │  │              │  │              │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                                     │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                                      │ HTTP/HTTPS
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│                           MIDDLEWARE LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Express Server                                │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │   CORS     │→ │  Session   │→ │  Passport  │→ │    Auth    │     │  │
│  │  │ Middleware │  │ Middleware │  │ Middleware │  │ Middleware │     │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ROUTING LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │              │  │              │  │              │  │              │   │
│  │ /auth/*      │  │ /api/*       │  │ /health      │  │ /*           │   │
│  │              │  │              │  │              │  │              │   │
│  │ Auth Routes  │  │ API Routes   │  │ Health Check │  │ Static Files │   │
│  │ (Public)     │  │ (Protected)  │  │ (Public)     │  │ (Protected)  │   │
│  │              │  │              │  │              │  │              │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────────────┘   │
│         │                 │                                                 │
│         │                 │                                                 │
└─────────┼─────────────────┼─────────────────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BUSINESS LOGIC LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │              │  │              │  │              │  │              │   │
│  │ Passport.js  │  │Infrastructure│  │   GitHub     │  │   Database   │   │
│  │              │  │   Service    │  │   Service    │  │   Service    │   │
│  │ Auth Logic   │  │              │  │              │  │              │   │
│  │              │  │              │  │              │  │              │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │              │  │              │  │              │  │              │   │
│  │  Entra ID    │  │  SQL Server  │  │  GitHub API  │  │  Azure APIs  │   │
│  │              │  │              │  │              │  │              │   │
│  │ (Auth)       │  │ (Sessions +  │  │ (Infra Code) │  │ (Resources)  │   │
│  │              │  │  App Data)   │  │              │  │              │   │
│  │              │  │              │  │              │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session Management Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SESSION MANAGEMENT FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐                    ┌─────────────┐                ┌──────────────┐
│          │                    │             │                │              │
│  Client  │                    │   Express   │                │  SQL Server  │
│ (Browser)│                    │   Server    │                │  (Sessions)  │
│          │                    │             │                │              │
└────┬─────┘                    └──────┬──────┘                └──────┬───────┘
     │                                 │                              │
     │  1. Login successful            │                              │
     │─────────────────────────────────►                              │
     │                                 │                              │
     │                                 │  2. Create session object    │
     │                                 │     {                        │
     │                                 │       user: {...},           │
     │                                 │       expires: Date,         │
     │                                 │       ...                    │
     │                                 │     }                        │
     │                                 │                              │
     │                                 │  3. Store session in DB      │
     │                                 │──────────────────────────────►
     │                                 │                              │
     │                                 │  4. Return session ID        │
     │                                 │◄──────────────────────────────
     │                                 │                              │
     │  5. Set session cookie          │                              │
     │     (sid=abc123...)             │                              │
     │◄─────────────────────────────────                              │
     │                                 │                              │
     │                                 │                              │
     │  6. Subsequent request          │                              │
     │     (Cookie: sid=abc123...)     │                              │
     │─────────────────────────────────►                              │
     │                                 │                              │
     │                                 │  7. Extract session ID       │
     │                                 │     from cookie              │
     │                                 │                              │
     │                                 │  8. Load session from DB     │
     │                                 │──────────────────────────────►
     │                                 │                              │
     │                                 │  9. Return session data      │
     │                                 │◄──────────────────────────────
     │                                 │                              │
     │                                 │  10. Deserialize user        │
     │                                 │      object from session     │
     │                                 │                              │
     │                                 │  11. Attach user to req      │
     │                                 │      req.user = {...}        │
     │                                 │                              │
     │  12. Process request with       │                              │
     │      authenticated user         │                              │
     │◄─────────────────────────────────                              │
     │                                 │                              │
     │                                 │                              │
     │  13. Logout request             │                              │
     │─────────────────────────────────►                              │
     │                                 │                              │
     │                                 │  14. Delete session from DB  │
     │                                 │──────────────────────────────►
     │                                 │                              │
     │  15. Clear session cookie       │                              │
     │◄─────────────────────────────────                              │
     │                                 │                              │
     │  16. Redirect to Entra ID       │                              │
     │      logout endpoint            │                              │
     │◄─────────────────────────────────                              │
     │                                 │                              │
     ▼                                 ▼                              ▼
```

---

## Database Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              sessions                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  sid              NVARCHAR(255)   PRIMARY KEY                                │
│  session          NVARCHAR(MAX)   NOT NULL                                   │
│  expires          DATETIME        NOT NULL                                   │
│                                                                              │
│  INDEX: IDX_sessions_expires ON (expires)                                    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Sample Data:                                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ sid: "abc123..."                                                     │  │
│  │ session: {                                                           │  │
│  │   "cookie": {                                                        │  │
│  │     "maxAge": 3600000,                                               │  │
│  │     "httpOnly": true,                                                │  │
│  │     "secure": true                                                   │  │
│  │   },                                                                 │  │
│  │   "passport": {                                                      │  │
│  │     "user": {                                                        │  │
│  │       "id": "user-oid-from-entra-id",                                │  │
│  │       "email": "user@domain.com",                                    │  │
│  │       "displayName": "John Doe",                                     │  │
│  │       "roles": ["InfraCatalog-Users"]                                │  │
│  │     }                                                                │  │
│  │   }                                                                  │  │
│  │ }                                                                    │  │
│  │ expires: 2025-11-06 15:30:00                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

Auto-cleanup:
- Expired sessions deleted automatically every 10 minutes
- Manual cleanup: DELETE FROM sessions WHERE expires < GETDATE()
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SECURITY LAYERS                                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: HTTPS/TLS                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ • All communication encrypted                                                │
│ • Valid SSL certificate                                                      │
│ • HSTS headers enabled                                                       │
│ • HTTP → HTTPS redirect                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Entra ID OAuth 2.0                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Multi-factor authentication (MFA)                                          │
│ • Conditional access policies                                                │
│ • Token validation (iss, aud, exp)                                           │
│ • User identity verification                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Session Management                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ • httpOnly cookies (XSS protection)                                          │
│ • secure flag (HTTPS-only)                                                   │
│ • sameSite policy (CSRF protection)                                          │
│ • Session timeout (1 hour)                                                   │
│ • Database-backed sessions                                                   │
│ • Strong session secret                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Authentication Middleware                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Session validation                                                         │
│ • User authentication check                                                  │
│ • Automatic login redirect                                                   │
│ • API 401/403 responses                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 5: Role-Based Access Control (RBAC)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Role validation                                                            │
│ • Group membership check                                                     │
│ • Operation-level permissions                                                │
│ • Audit logging                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 6: Application Logic                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Input validation                                                           │
│ • SQL injection prevention                                                   │
│ • XSS prevention                                                             │
│ • CSRF token validation                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture (Kubernetes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      KUBERNETES DEPLOYMENT                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         Ingress Controller                                   │
│                    (HTTPS Termination + Routing)                             │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          │ https://your-domain.com
                          │
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                           Kubernetes Service                                 │
│                       (LoadBalancer / ClusterIP)                             │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
           ▼              ▼              ▼
    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │   Pod 1   │  │   Pod 2   │  │   Pod 3   │
    ├───────────┤  ├───────────┤  ├───────────┤
    │           │  │           │  │           │
    │ Container │  │ Container │  │ Container │
    │           │  │           │  │           │
    │ ┌───────┐ │  │ ┌───────┐ │  │ ┌───────┐ │
    │ │Express│ │  │ │Express│ │  │ │Express│ │
    │ │Server │ │  │ │Server │ │  │ │Server │ │
    │ │       │ │  │ │       │ │  │ │       │ │
    │ │+Auth  │ │  │ │+Auth  │ │  │ │+Auth  │ │
    │ └───────┘ │  │ └───────┘ │  │ └───────┘ │
    │           │  │           │  │           │
    └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
          │              │              │
          └──────────────┼──────────────┘
                         │
                         │ Environment Variables
                         │ from ConfigMap + Secrets
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│              │  │              │  │              │
│  ConfigMap   │  │   Secrets    │  │   Volumes    │
│              │  │              │  │              │
│ • Redirect   │  │ • Client ID  │  │ • Logs       │
│   URIs       │  │ • Secret     │  │ • Config     │
│ • Timeouts   │  │ • Tenant ID  │  │              │
│              │  │ • Session    │  │              │
│              │  │   Secret     │  │              │
└──────────────┘  └──────────────┘  └──────────────┘


External Dependencies:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│              │  │              │  │              │
│  Entra ID    │  │  SQL Server  │  │  GitHub API  │
│              │  │              │  │              │
│ (Microsoft)  │  │ (Sessions +  │  │ (Infra Code) │
│              │  │  App Data)   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ERROR HANDLING FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Request comes in
      │
      ▼
┌─────────────┐
│ Auth Check  │
└──────┬──────┘
       │
       ├─ No session? ──────┐
       │                    │
       ▼                    ▼
  Has session          Is API request?
       │                    │
       ├─ Expired? ──┐      ├─ YES ─► 401 JSON Response
       │             │      │           {error: "Unauthorized"}
       ▼             ▼      │
  Valid session   Clear    └─ NO ──► 302 Redirect
       │           session               to /login.html
       │             │
       ▼             ▼
┌─────────────┐  ┌──────────┐
│ Role Check  │  │  Logout  │
└──────┬──────┘  └──────────┘
       │
       ├─ No required role? ──┐
       │                      │
       ▼                      ▼
  Has role              403 JSON Response
       │                {error: "Forbidden",
       │                 message: "Insufficient permissions"}
       ▼
┌─────────────┐
│  Process    │
│  Request    │
└──────┬──────┘
       │
       ├─ Server error? ──┐
       │                  │
       ▼                  ▼
   Success           500 JSON Response
       │              {error: "Internal Server Error",
       │               correlationId: "..."}
       ▼
  Return Response


Frontend Handling:
┌─────────────┐
│ Fetch API   │
└──────┬──────┘
       │
       ├─ 401? ─────► Redirect to /login.html
       │
       ├─ 403? ─────► Show "Access Denied" message
       │
       ├─ 500? ─────► Show error modal with correlationId
       │
       └─ 200 ──────► Process response
```

---

## Configuration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CONFIGURATION HIERARCHY                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Azure Portal (One-time setup)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ • App Registration                                                           │
│ • Client ID / Secret generation                                             │
│ • Redirect URI configuration                                                │
│ • API Permissions                                                            │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. Environment Variables (.env / Kubernetes Secrets)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ AZURE_AD_CLIENT_ID        ◄─── From Azure Portal                            │
│ AZURE_AD_CLIENT_SECRET    ◄─── From Azure Portal                            │
│ AZURE_AD_TENANT_ID        ◄─── From Azure Portal                            │
│ AZURE_AD_REDIRECT_URI     ◄─── Your app's callback URL                      │
│ SESSION_SECRET            ◄─── Generated random string                      │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Config Files (code)                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ config/auth.js        ◄─── Reads env vars, builds config                    │
│ config/passport.js    ◄─── Uses auth config                                 │
│ config/session.js     ◄─── Uses session secret + DB config                  │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Express Server (server.js)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Loads config files                                                         │
│ • Initializes middleware                                                     │
│ • Sets up routes                                                             │
│ • Starts listening                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

These diagrams illustrate:

1. **Authentication Flow**: Complete OAuth 2.0/OpenID Connect flow with Entra ID
2. **Component Architecture**: Multi-layer system architecture
3. **Session Management**: How sessions are created, stored, and validated
4. **Database Schema**: Session storage structure
5. **Security Layers**: Defense-in-depth security approach
6. **Kubernetes Deployment**: Container orchestration and configuration
7. **Error Handling**: How different error scenarios are handled
8. **Configuration**: How configuration flows from Azure to runtime

For implementation details, see:
- `docs/entra-id-integration-plan.md` - Full implementation guide
- `docs/entra-id-quick-start.md` - Quick start guide
- `docs/entra-id-code-changes.md` - Code changes summary
