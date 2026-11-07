# E2E Authentication Quick Reference

## 🚀 Quick Start (3 steps)

### 1. Add Test Credentials to `.env`
```bash
E2E_TEST_USERNAME=e2e-test@yourdomain.com
E2E_TEST_PASSWORD=YourSecurePassword123!
```

### 2. Run Authentication Setup
```bash
npx playwright test --project=setup
```

### 3. Run E2E Tests
```bash
npm run test:e2e
```

Done! All tests run with authenticated session.

---

## 📋 Common Commands

```bash
# First-time setup (install browsers)
npx playwright install --with-deps

# Run E2E tests (all browsers)
npm run test:e2e

# Run in headed mode (watch tests execute)
npm run test:e2e:headed

# Run specific browser
npm run test:e2e -- --project=chromium

# Debug mode (step through tests)
npm run test:e2e:debug

# Update authentication (if session expired)
npm run test:e2e -- --project=setup

# Run specific test file
npm run test:e2e -- tests/e2e/custom-infra.spec.ts
```

---

## 🔧 Troubleshooting

### Issue: "E2E_TEST_USERNAME must be set"
**Fix:** Add credentials to `.env` file

### Issue: "Timeout waiting for login page"
**Fix:** Check `VITE_ENTRA_CLIENT_ID` in `.env`

### Issue: "Authentication state expired"
**Fix:** Delete `.auth/` folder and re-run setup:
```bash
rm -rf .auth/
npx playwright test --project=setup
```

### Issue: "Cannot find login button"
**Fix:** Update selector in `tests/e2e/auth.setup.ts`:
```typescript
const loginButton = page.locator('[data-testid="your-login-button"]')
```

---

## 📖 Full Documentation

See [E2E-AUTHENTICATION.md](./E2E-AUTHENTICATION.md) for:
- Creating test users
- CI/CD integration
- Security best practices
- Advanced configuration
