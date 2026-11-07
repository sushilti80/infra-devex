#!/bin/bash

# API Endpoint Testing Script
# Usage: ./scripts/test-endpoints.sh [base-url]

set -e

BASE_URL="${1:-http://localhost:3000}"

echo "========================================"
echo "API Endpoint Testing"
echo "========================================"
echo "Base URL: $BASE_URL"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local expected_status=$3
    local description=$4

    echo "Testing: $description"
    echo "  $method $endpoint"

    response=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE_URL$endpoint" 2>/dev/null)

    if [ "$response" -eq "$expected_status" ]; then
        echo -e "  ${GREEN}✓ PASS${NC}: Got $response (expected $expected_status)"
        ((PASS++))
    else
        echo -e "  ${RED}✗ FAIL${NC}: Got $response (expected $expected_status)"
        ((FAIL++))
    fi
    echo ""
}

# Function to test endpoint with response body
test_endpoint_with_body() {
    local method=$1
    local endpoint=$2
    local expected_status=$3
    local description=$4

    echo "Testing: $description"
    echo "  $method $endpoint"

    response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" 2>/dev/null)
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status_code" -eq "$expected_status" ]; then
        echo -e "  ${GREEN}✓ PASS${NC}: Got $status_code (expected $expected_status)"
        echo "  Response: ${body:0:100}..."
        ((PASS++))
    else
        echo -e "  ${RED}✗ FAIL${NC}: Got $status_code (expected $expected_status)"
        echo "  Response: $body"
        ((FAIL++))
    fi
    echo ""
}

echo "========================================"
echo "1. Basic Connectivity Tests"
echo "========================================"

# Health check (if exists)
test_endpoint "GET" "/health" "200" "Health check endpoint"

# Root endpoint
test_endpoint "GET" "/" "200" "Root endpoint"

echo "========================================"
echo "2. API Endpoint Tests"
echo "========================================"

# Get modules
test_endpoint_with_body "GET" "/api/modules" "200" "Get available modules"

# Get templates
test_endpoint_with_body "GET" "/api/templates" "200" "Get templates"

# Get environments
test_endpoint_with_body "GET" "/api/environments" "200" "Get environments"

echo "========================================"
echo "3. Invalid Endpoint Tests"
echo "========================================"

# Non-existent endpoint
test_endpoint "GET" "/api/nonexistent" "404" "Non-existent endpoint should return 404"

echo "========================================"
echo "4. POST Endpoint Validation Tests"
echo "========================================"

# Test POST without body (should fail validation)
test_endpoint "POST" "/api/custom" "400" "POST /api/custom without body should fail"
test_endpoint "POST" "/api/template" "400" "POST /api/template without body should fail"

echo "========================================"
echo "SUMMARY"
echo "========================================"
echo -e "Tests Passed: ${GREEN}$PASS${NC}"
echo -e "Tests Failed: ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All endpoint tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some endpoint tests failed. Please review above.${NC}"
    exit 1
fi
