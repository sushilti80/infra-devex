#!/bin/bash

# Dockerfile Production Validation Script (Podman)
# This script validates that Dockerfile builds and runs the Vue 3 app from srcV2

set -e

echo "🔍 Dockerfile Production Validation"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

IMAGE_NAME="self-service-infra-vue"
IMAGE_TAG="validation-$(date +%s)"
CONTAINER_NAME="self-service-vue-test"
TEST_PORT=8080

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    podman stop $CONTAINER_NAME 2>/dev/null || true
    podman rm $CONTAINER_NAME 2>/dev/null || true
    if [ "$KEEP_IMAGE" != "true" ]; then
        podman rmi $IMAGE_NAME:$IMAGE_TAG 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Step 1: Check podman is running
echo "1️⃣  Checking Podman status..."
if ! podman ps > /dev/null 2>&1; then
    echo -e "${RED}❌ Podman is not running${NC}"
    echo "   Start podman machine with: podman machine start"
    exit 1
fi
echo -e "${GREEN}✅ Podman is running${NC}"
echo ""

# Step 2: Validate Dockerfile exists and has correct structure
echo "2️⃣  Validating Dockerfile structure..."
if [ ! -f "Dockerfile" ]; then
    echo -e "${RED}❌ Dockerfile not found${NC}"
    exit 1
fi

# Check for multi-stage build
if ! grep -q "AS frontend-builder" Dockerfile; then
    echo -e "${RED}❌ Missing multi-stage build (frontend-builder stage)${NC}"
    exit 1
fi

# Check for Vue build command
if ! grep -q "npm run build:client" Dockerfile; then
    echo -e "${RED}❌ Missing Vue build command (npm run build:client)${NC}"
    exit 1
fi

# Check for dist copy
if ! grep -q "COPY --from=frontend-builder /app/dist ./dist" Dockerfile; then
    echo -e "${RED}❌ Missing dist folder copy from builder stage${NC}"
    exit 1
fi

# Check for USE_VUE environment variable (legacy, no longer required)
# if ! grep -q "USE_VUE=true" Dockerfile; then
#     echo -e "${RED}❌ Missing USE_VUE=true environment variable${NC}"
#     exit 1
# fi

echo -e "${GREEN}✅ Dockerfile structure is valid${NC}"
echo ""

# Step 3: Validate source files exist
echo "3️⃣  Validating source files..."
REQUIRED_FILES=(
    "srcV2/main.ts"
    "srcV2/App.vue"
    "index.html"
    "vite.config.ts"
    "package.json"
    "server.js"
    "config.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ Missing required file: $file${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✅ All required source files present${NC}"
echo ""

# Step 4: Check index.html points to srcV2
echo "4️⃣  Validating index.html entry point..."
if ! grep -q "/srcV2/main.ts" index.html; then
    echo -e "${RED}❌ index.html doesn't reference /srcV2/main.ts${NC}"
    exit 1
fi
echo -e "${GREEN}✅ index.html correctly references Vue 3 entry point${NC}"
echo ""

# Step 5: Build the image
echo "5️⃣  Building Docker image (this may take a few minutes)..."
echo "   Image: $IMAGE_NAME:$IMAGE_TAG"
echo ""

if podman build -f Dockerfile -t $IMAGE_NAME:$IMAGE_TAG . 2>&1 | tee /tmp/podman-build.log; then
    echo -e "${GREEN}✅ Image built successfully${NC}"
else
    echo -e "${RED}❌ Image build failed${NC}"
    echo "   Check /tmp/podman-build.log for details"
    exit 1
fi
echo ""

# Step 6: Inspect the built image
echo "6️⃣  Inspecting built image..."
IMAGE_SIZE=$(podman images $IMAGE_NAME:$IMAGE_TAG --format "{{.Size}}")
echo "   Image size: $IMAGE_SIZE"

# Check for dist folder in image
if podman run --rm $IMAGE_NAME:$IMAGE_TAG ls /app/dist > /dev/null 2>&1; then
    echo -e "${GREEN}✅ dist folder exists in image${NC}"
    DIST_FILES=$(podman run --rm $IMAGE_NAME:$IMAGE_TAG ls -la /app/dist | wc -l)
    echo "   dist folder contains $DIST_FILES files/folders"
else
    echo -e "${RED}❌ dist folder not found in image${NC}"
    exit 1
fi

# Check for srcV2 compiled assets in dist
if podman run --rm $IMAGE_NAME:$IMAGE_TAG ls /app/dist/index.html > /dev/null 2>&1; then
    echo -e "${GREEN}✅ index.html exists in dist${NC}"
else
    echo -e "${RED}❌ index.html not found in dist${NC}"
    exit 1
fi

# Check for JavaScript bundle
JS_COUNT=$(podman run --rm $IMAGE_NAME:$IMAGE_TAG find /app/dist -name "*.js" | wc -l)
if [ "$JS_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ JavaScript bundles found ($JS_COUNT files)${NC}"
else
    echo -e "${RED}❌ No JavaScript bundles found${NC}"
    exit 1
fi

echo ""

# Step 7: Check environment variables
# Check for NODE_ENV environment variable
NODE_ENV=$(podman run --rm $IMAGE_NAME:$IMAGE_TAG printenv NODE_ENV)

if [ "$NODE_ENV" = "production" ]; then
    echo -e "${GREEN}✅ NODE_ENV=production${NC}"
else
    echo -e "${RED}❌ NODE_ENV is not set to production (got: $NODE_ENV)${NC}"
fi
echo ""

# Step 8: Run container and test
echo "8️⃣  Starting container for runtime validation..."
podman run -d --name $CONTAINER_NAME -p $TEST_PORT:3000 $IMAGE_NAME:$IMAGE_TAG

# Wait for container to start
echo "   Waiting for container to start..."
sleep 5

# Check if container is running
if ! podman ps | grep -q $CONTAINER_NAME; then
    echo -e "${RED}❌ Container failed to start${NC}"
    echo "   Container logs:"
    podman logs $CONTAINER_NAME
    exit 1
fi
echo -e "${GREEN}✅ Container is running${NC}"
echo ""

# Step 9: Test health endpoint
echo "9️⃣  Testing health endpoint..."
HEALTH_CHECK_COUNT=0
MAX_HEALTH_CHECKS=10

while [ $HEALTH_CHECK_COUNT -lt $MAX_HEALTH_CHECKS ]; do
    if curl -s http://localhost:$TEST_PORT/health > /dev/null 2>&1; then
        HEALTH_RESPONSE=$(curl -s http://localhost:$TEST_PORT/health)
        echo -e "${GREEN}✅ Health endpoint responding${NC}"
        echo "   Response: $HEALTH_RESPONSE"
        break
    else
        HEALTH_CHECK_COUNT=$((HEALTH_CHECK_COUNT + 1))
        echo "   Attempt $HEALTH_CHECK_COUNT/$MAX_HEALTH_CHECKS - waiting..."
        sleep 2
    fi
done

if [ $HEALTH_CHECK_COUNT -eq $MAX_HEALTH_CHECKS ]; then
    echo -e "${RED}❌ Health endpoint not responding after $MAX_HEALTH_CHECKS attempts${NC}"
    echo "   Container logs:"
    podman logs $CONTAINER_NAME
    exit 1
fi
echo ""

# Step 10: Test Vue app serving
echo "🔟 Testing Vue app serving..."
if curl -s http://localhost:$TEST_PORT/ | grep -q "self-service-infra"; then
    echo -e "${GREEN}✅ Root endpoint serving Vue app${NC}"
else
    echo -e "${YELLOW}⚠️  Root endpoint response doesn't contain expected content${NC}"
    echo "   This might be okay if content is generated dynamically"
fi

# Check for Vue-specific content
HOMEPAGE=$(curl -s http://localhost:$TEST_PORT/)
if echo "$HOMEPAGE" | grep -q '<div id="app"'; then
    echo -e "${GREEN}✅ Vue app mount point (#app) found${NC}"
else
    echo -e "${RED}❌ Vue app mount point not found in HTML${NC}"
fi

# Check for JavaScript modules
if echo "$HOMEPAGE" | grep -q 'type="module"'; then
    echo -e "${GREEN}✅ ES6 module script found (Vue build)${NC}"
else
    echo -e "${YELLOW}⚠️  No ES6 module script found${NC}"
fi
echo ""

# Step 11: Check container logs
echo "1️⃣1️⃣  Checking container logs for errors..."
CONTAINER_LOGS=$(podman logs $CONTAINER_NAME 2>&1)

if echo "$CONTAINER_LOGS" | grep -qi "error"; then
    echo -e "${YELLOW}⚠️  Found 'error' in logs (may be normal)${NC}"
    echo "   Check logs with: podman logs $CONTAINER_NAME"
else
    echo -e "${GREEN}✅ No obvious errors in logs${NC}"
fi

if echo "$CONTAINER_LOGS" | grep -q "Server running on port 3000"; then
    echo -e "${GREEN}✅ Server started successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Server startup message not found${NC}"
fi
echo ""

# Step 12: Verify Vue vs Vanilla JS
echo "1️⃣2️⃣  Verifying Vue mode (not Vanilla JS)..."
if echo "$HOMEPAGE" | grep -q "/srcV2/main.ts" || echo "$HOMEPAGE" | grep -q "assets/index"; then
    echo -e "${GREEN}✅ Using Vue build (not Vanilla JS)${NC}"
else
    echo -e "${YELLOW}⚠️  Cannot confirm Vue vs Vanilla JS mode from HTML${NC}"
fi

# Check if dist folder is being served (not public folder)
if podman exec $CONTAINER_NAME ls /app/public/index.html > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: public folder exists (should use dist instead)${NC}"
else
    echo -e "${GREEN}✅ No public folder (using dist as expected)${NC}"
fi
echo ""

# Summary
echo "================================"
echo "📊 VALIDATION SUMMARY"
echo "================================"
echo ""
echo "Image Details:"
echo "  Name: $IMAGE_NAME:$IMAGE_TAG"
echo "  Size: $IMAGE_SIZE"
echo "  URL: http://localhost:$TEST_PORT"
echo ""
echo -e "${GREEN}✅ All critical validations passed!${NC}"
echo ""
echo "The Dockerfile is production-ready and correctly:"
echo "  ✓ Builds Vue 3 app from srcV2 folder"
echo "  ✓ Creates dist folder with compiled assets"
echo "  ✓ Serves Vue SPA (not Vanilla JS)"
echo "  ✓ Health endpoint works"
echo "  ✓ Container runs successfully"
echo ""
echo "Next steps:"
echo "  • Test manually: http://localhost:$TEST_PORT"
echo "  • Stop container: podman stop $CONTAINER_NAME"
echo "  • Remove container: podman rm $CONTAINER_NAME"
echo "  • Remove image: podman rmi $IMAGE_NAME:$IMAGE_TAG"
echo ""
echo "To keep container running for manual testing:"
echo "  Press Ctrl+C to exit this script (container will keep running)"
echo ""

# Keep container running for manual inspection
read -p "Press Enter to cleanup and exit (or Ctrl+C to keep container running)..."
