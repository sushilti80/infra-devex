#!/bin/bash

# AKS Deployment Validation Script
# Usage: ./scripts/validate-aks-deployment.sh [namespace] [app-name]

# Don't exit on error, we want to continue checking
set +e

NAMESPACE="${1:-self-service-test}"
APP_NAME="${2:-self-service-test-app}"
SECRET_NAME="${3:-self-service-test-secret}"

echo "========================================"
echo "AKS Deployment Validation"
echo "========================================"
echo "Namespace: $NAMESPACE"
echo "App Name: $APP_NAME"
echo "Secret Name: $SECRET_NAME"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Function to check test result
check_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        ((FAIL++))
    fi
}

echo "========================================"
echo "1. Checking Kubernetes Connection"
echo "========================================"
kubectl cluster-info > /dev/null 2>&1
check_result $? "Kubernetes cluster connection"
echo ""

echo "========================================"
echo "2. Checking Namespace"
echo "========================================"
kubectl get namespace $NAMESPACE > /dev/null 2>&1
check_result $? "Namespace '$NAMESPACE' exists"
echo ""

echo "========================================"
echo "3. Checking Secret Configuration"
echo "========================================"
kubectl get secret $SECRET_NAME -n $NAMESPACE > /dev/null 2>&1
check_result $? "Secret '$SECRET_NAME' exists"

# Check required secret keys
REQUIRED_KEYS=(
    "GITHUB_APP_ID"
    "GITHUB_INSTALLATION_ID"
    "GITHUB_PRIVATE_KEY"
    "GITHUB_CODE_APP_ID"
    "GITHUB_CODE_INSTALLATION_ID"
    "GITHUB_CODE_PRIVATE_KEY"
)

echo ""
echo "Checking secret keys:"
for key in "${REQUIRED_KEYS[@]}"; do
    kubectl get secret $SECRET_NAME -n $NAMESPACE -o jsonpath="{.data.$key}" 2>/dev/null | base64 -d > /dev/null 2>&1
    if [ ${PIPESTATUS[0]} -eq 0 ] && [ ! -z "$(kubectl get secret $SECRET_NAME -n $NAMESPACE -o jsonpath="{.data.$key}")" ]; then
        echo -e "  ${GREEN}✓${NC} $key exists and has value"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $key missing or empty"
        ((FAIL++))
    fi
done
echo ""

echo "========================================"
echo "4. Checking Deployment"
echo "========================================"
kubectl get deployment $APP_NAME -n $NAMESPACE > /dev/null 2>&1
check_result $? "Deployment '$APP_NAME' exists"

DESIRED=$(kubectl get deployment $APP_NAME -n $NAMESPACE -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
READY=$(kubectl get deployment $APP_NAME -n $NAMESPACE -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")

if [ "$DESIRED" -eq "$READY" ] && [ "$READY" -gt 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: Deployment replicas ready ($READY/$DESIRED)"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL${NC}: Deployment replicas not ready ($READY/$DESIRED)"
    ((FAIL++))
fi
echo ""

echo "========================================"
echo "5. Checking Pods"
echo "========================================"
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=$APP_NAME -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ ! -z "$POD_NAME" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Pod exists: $POD_NAME"
    ((PASS++))

    POD_STATUS=$(kubectl get pod $POD_NAME -n $NAMESPACE -o jsonpath='{.status.phase}')
    if [ "$POD_STATUS" == "Running" ]; then
        echo -e "${GREEN}✓ PASS${NC}: Pod status is Running"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: Pod status is $POD_STATUS"
        ((FAIL++))
    fi

    # Check pod restarts
    RESTARTS=$(kubectl get pod $POD_NAME -n $NAMESPACE -o jsonpath='{.status.containerStatuses[0].restartCount}')
    if [ "$RESTARTS" -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: No pod restarts"
        ((PASS++))
    else
        echo -e "${YELLOW}⚠ WARN${NC}: Pod has restarted $RESTARTS times"
    fi
else
    echo -e "${RED}✗ FAIL${NC}: No pods found"
    ((FAIL++))
fi
echo ""

echo "========================================"
echo "6. Checking Pod Logs for Errors"
echo "========================================"
if [ ! -z "$POD_NAME" ]; then
    echo "Recent logs from pod:"
    echo "----------------------------------------"
    kubectl logs $POD_NAME -n $NAMESPACE --tail=20 2>/dev/null || echo "Could not fetch logs"
    echo "----------------------------------------"

    ERROR_COUNT=$(kubectl logs $POD_NAME -n $NAMESPACE --tail=100 2>/dev/null | grep -i "error\|fail\|exception" | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: No errors in recent logs"
        ((PASS++))
    else
        echo -e "${YELLOW}⚠ WARN${NC}: Found $ERROR_COUNT error lines in logs"
    fi

    # Check for specific initialization success
    kubectl logs $POD_NAME -n $NAMESPACE --tail=100 2>/dev/null | grep -q "Server running on port"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: Server started successfully"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: Server startup message not found"
        ((FAIL++))
    fi

    # Check for GitHub initialization
    kubectl logs $POD_NAME -n $NAMESPACE --tail=100 2>/dev/null | grep -q "GitHub App authentication initialized"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: GitHub App initialized successfully"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: GitHub App initialization failed or not found"
        ((FAIL++))
    fi
fi
echo ""

echo "========================================"
echo "7. Checking Service"
echo "========================================"
kubectl get service -n $NAMESPACE -l app=$APP_NAME > /dev/null 2>&1
if [ $? -eq 0 ]; then
    SVC_NAME=$(kubectl get service -n $NAMESPACE -l app=$APP_NAME -o jsonpath='{.items[0].metadata.name}')
    echo -e "${GREEN}✓ PASS${NC}: Service exists: $SVC_NAME"
    ((PASS++))

    SVC_PORT=$(kubectl get service $SVC_NAME -n $NAMESPACE -o jsonpath='{.spec.ports[0].port}')
    echo -e "${GREEN}✓ INFO${NC}: Service port: $SVC_PORT"
else
    echo -e "${YELLOW}⚠ WARN${NC}: No service found"
fi
echo ""

echo "========================================"
echo "8. Checking Ingress"
echo "========================================"
kubectl get ingress -n $NAMESPACE > /dev/null 2>&1
if [ $? -eq 0 ]; then
    INGRESS_NAME=$(kubectl get ingress -n $NAMESPACE -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ ! -z "$INGRESS_NAME" ]; then
        echo -e "${GREEN}✓ PASS${NC}: Ingress exists: $INGRESS_NAME"
        ((PASS++))

        INGRESS_HOST=$(kubectl get ingress $INGRESS_NAME -n $NAMESPACE -o jsonpath='{.spec.rules[0].host}')
        echo -e "${GREEN}✓ INFO${NC}: Ingress host: $INGRESS_HOST"

        # Check if ingress has address
        INGRESS_IP=$(kubectl get ingress $INGRESS_NAME -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
        if [ ! -z "$INGRESS_IP" ]; then
            echo -e "${GREEN}✓ PASS${NC}: Ingress has IP: $INGRESS_IP"
            ((PASS++))
        else
            echo -e "${YELLOW}⚠ WARN${NC}: Ingress has no IP assigned yet"
        fi
    else
        echo -e "${YELLOW}⚠ WARN${NC}: No ingress found"
    fi
else
    echo -e "${YELLOW}⚠ WARN${NC}: No ingress configured"
fi
echo ""

echo "========================================"
echo "9. Environment Variables Check"
echo "========================================"
if [ ! -z "$POD_NAME" ]; then
    REQUIRED_ENV=(
        "GITHUB_APP_ID"
        "GITHUB_INSTALLATION_ID"
        "GITHUB_CODE_APP_ID"
        "GITHUB_CODE_INSTALLATION_ID"
        "PORT"
    )

    for env_var in "${REQUIRED_ENV[@]}"; do
        VALUE=$(kubectl exec $POD_NAME -n $NAMESPACE -- printenv $env_var 2>/dev/null)
        if [ ! -z "$VALUE" ]; then
            echo -e "  ${GREEN}✓${NC} $env_var is set"
            ((PASS++))
        else
            echo -e "  ${RED}✗${NC} $env_var is NOT set"
            ((FAIL++))
        fi
    done
fi
echo ""

echo "========================================"
echo "SUMMARY"
echo "========================================"
echo -e "Tests Passed: ${GREEN}$PASS${NC}"
echo -e "Tests Failed: ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All validation checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some validation checks failed. Please review above.${NC}"
    exit 1
fi
