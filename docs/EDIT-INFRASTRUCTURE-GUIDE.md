# Edit Infrastructure — User Guide

**Available since:** v2.2.0 (June 2026)
**Feature flag:** `VITE_ENABLE_CATALOG_PREFILL=true` (build-arg required)

---

## What this feature does

The **Edit Infrastructure** button on the Installed Apps page lets you open an existing deployed application directly in the Custom Infrastructure wizard with its current configuration pre-loaded. You can then modify modules or RBAC relationships and re-deploy.

---

## How to edit an existing app

1. Open the **Installed Apps** page from the left navigation.
2. Locate the application you want to modify.
3. Click the **pencil icon** (Edit Infrastructure) in the app's action toolbar.
4. The Custom Infrastructure wizard opens automatically with the app's modules, RBAC relationships, and metadata pre-filled.
5. An "Editing existing app" banner at the top confirms which app and environment is loaded.
6. Make your changes — add or remove modules, update RBAC relationships, adjust configuration.
7. Proceed through the wizard steps and click **Generate Infrastructure Code** to submit.

> If you want to start from a blank wizard instead, click **Clear and start fresh** in the editing banner.

---

## How it works (technical)

```
User clicks Edit on InstalledAppsPage
  → navigationStore.navigateToPage('custom', { appName, environment })
  → CustomInfrastructurePage mounts
  → onMounted reads navigationStore.prefillContext
  → Validates appName/environment (regex: /^[a-zA-Z0-9_-]{1,64}$/)
  → Clears context immediately (prevents re-trigger on back-navigation)
  → Calls GET /api/app-metadata/:appName/:environment
  → On success: modules, RBAC relationships, and metadata pre-loaded
  → isEditingMode = true; editing banner displayed
  → On failure: step0Error shown; wizard remains usable for manual entry
```

The navigation context is cleared **before** the API call. Navigating back and forward will not re-trigger the load.

---

## Feature flag

The Edit button and auto-load are both gated on `VITE_ENABLE_CATALOG_PREFILL`.

| Value | Behaviour |
|---|---|
| `true` (default) | Edit button visible; auto-load runs on mount |
| `false` | Edit button hidden; auto-load skipped |

### Setting the flag

**Local development:**
```bash
# .env or shell
VITE_ENABLE_CATALOG_PREFILL=true
```

**Docker build:**
```bash
docker build \
  --build-arg VITE_ENABLE_CATALOG_PREFILL=true \
  -t self-service-infra:v2.2.0 \
  -f Dockerfile .
```

**Kubernetes (values or secret):**
```yaml
env:
  - name: VITE_ENABLE_CATALOG_PREFILL
    value: "true"
```

> Note: `VITE_` prefix means this is a **build-time** variable baked into the JS bundle. It cannot be changed at runtime without rebuilding the image.

---

## API used

```
GET /api/app-metadata/:appName/:environment
```

This endpoint reads the app's metadata JSON from the service-catalog GitHub repository (`docs/metadata/<appName>-<environment>.json`) and returns it. No new endpoints were added for this feature.

Requires authentication. The correlation ID is logged for every request.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Edit button not visible | `VITE_ENABLE_CATALOG_PREFILL` not set to `true` | Rebuild image with the build-arg |
| "Unable to reach the server" banner | API call failed — server unreachable | Check backend health at `GET /health` |
| "App not found" or metadata missing | `docs/metadata/<app>-<env>.json` does not exist in service-catalog | Verify the app was provisioned through the self-service catalog |
| Wizard opens blank (no pre-fill) | Auto-load ran but the API returned no data | See server logs for `app-metadata fetch failed` with the correlation ID |
| Editing banner shows but modules missing | Metadata exists but has no `modules` array | Check the metadata JSON in service-catalog |

---

## Design decisions

- **Single entry point:** The manual "Load from existing app" panel inside the Custom Infra wizard was removed. The Edit button on Installed Apps is the intentional, discoverable entry point.
- **No double-load:** The navigation context is cleared synchronously before the `await getAppMetadata()` call. Navigating away and back does not re-trigger the load.
- **Failure is safe:** If the auto-load fails, `isEditingMode` is set to `false` and the error is shown in a banner. The wizard remains fully usable for manual entry.
- **RBAC auto-added:** If the loaded metadata includes RBAC relationships, the RBAC module is automatically added to the selected modules list (same behaviour as the manual wizard).
