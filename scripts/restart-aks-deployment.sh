#!/bin/bash

# AKS Deployment Restart Script
# Usage: ./scripts/restart-aks-deployment.sh [namespace] [app-name]

NAMESPACE="${1:-self-service-test}"
APP_NAME="${2:-self-service-test-app}"

echo "========================================"
echo "AKS Deployment Restart"
echo "========================================"
echo "Namespace: $NAMESPACE"
echo "App Name: $APP_NAME"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if deployment exists
echo "Checking if deployment exists..."
kubectl get deployment $APP_NAME -n $NAMESPACE > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ ERROR${NC}: Deployment '$APP_NAME' not found in namespace '$NAMESPACE'"
    exit 1
fi

echo -e "${GREEN}✓${NC} Deployment found"
echo ""

# Get current state
echo "Current deployment state:"
kubectl get deployment $APP_NAME -n $NAMESPACE
echo ""

# Get pod info before restart
echo "Current pods:"
kubectl get pods -n $NAMESPACE -l app=$APP_NAME
echo ""

# Confirm restart
echo -e "${YELLOW}⚠ WARNING${NC}: This will restart all pods in the deployment."
read -p "Do you want to continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restart cancelled."
    exit 0
fi

echo ""
echo "========================================"
echo "Restarting Deployment"
echo "========================================"

# Restart the deployment
kubectl rollout restart deployment/$APP_NAME -n $NAMESPACE

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Restart initiated successfully"
else
    echo -e "${RED}✗${NC} Failed to restart deployment"
    exit 1
fi

echo ""
echo "Waiting for rollout to complete..."
kubectl rollout status deployment/$APP_NAME -n $NAMESPACE --timeout=5m

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Deployment restarted successfully"
else
    echo -e "${RED}✗${NC} Rollout did not complete successfully"
    exit 1
fi

echo ""
echo "========================================"
echo "New Deployment State"
echo "========================================"
kubectl get deployment $APP_NAME -n $NAMESPACE
echo ""

echo "New pods:"
kubectl get pods -n $NAMESPACE -l app=$APP_NAME
echo ""

# Get container image version
echo "========================================"
echo "Container Image Version"
echo "========================================"
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=$APP_NAME -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ ! -z "$POD_NAME" ]; then
    IMAGE=$(kubectl get pod $POD_NAME -n $NAMESPACE -o jsonpath='{.spec.containers[0].image}')
    echo -e "${GREEN}✓${NC} Current image: $IMAGE"
else
    echo -e "${YELLOW}⚠${NC} Could not retrieve image version"
fi
echo ""

# Get new pod name and show logs
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=$APP_NAME -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ ! -z "$POD_NAME" ]; then
    echo "========================================"
    echo "Recent Logs from New Pod"
    echo "========================================"
    echo "Pod: $POD_NAME"
    echo "----------------------------------------"
    kubectl logs $POD_NAME -n $NAMESPACE --tail=30
    echo "----------------------------------------"
fi

echo ""
echo -e "${GREEN}✓ Deployment restart complete!${NC}"
echo ""
echo "Next steps:"
echo "  - Run validation: ./scripts/validate-aks-deployment.sh"
echo "  - Test endpoints: ./scripts/test-endpoints.sh"
