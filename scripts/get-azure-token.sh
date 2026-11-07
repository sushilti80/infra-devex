#!/bin/bash

# Get Azure AD Token for Testing
# This script helps you get a JWT token from Azure AD

echo "🔐 Getting Azure AD Token"
echo "=================================="
echo ""

# Your Azure AD configuration
TENANT_ID="c32ce235-4d9a-4296-a647-a9edb2912ac9"
CLIENT_ID="ee62dfaa-bd92-4f1d-888d-16e7e81f8e18"

echo "Tenant ID: $TENANT_ID"
echo "Client ID: $CLIENT_ID"
echo ""

# Step 1: Login to Azure (opens browser)
echo "📝 Step 1: Logging in to Azure AD..."
echo "This will open your browser to sign in."
echo ""

az login --tenant $TENANT_ID --allow-no-subscriptions

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Login failed!"
    exit 1
fi

echo ""
echo "✅ Login successful!"
echo ""

# Step 2: Get access token
echo "📝 Step 2: Getting access token..."
echo ""

TOKEN=$(az account get-access-token --resource $CLIENT_ID --query accessToken -o tsv 2>&1)

if [ $? -eq 0 ] && [ ! -z "$TOKEN" ]; then
    echo "✅ Token retrieved successfully!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "YOUR JWT TOKEN (copy this):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "$TOKEN"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📋 Next steps:"
    echo "  1. Copy the token above"
    echo "  2. Use in Postman: Set 'token' variable to this value"
    echo "  3. Or test via curl: curl -H \"Authorization: Bearer <token>\" http://localhost:3000/api/environments"
    echo ""
else
    echo "❌ Failed to get token!"
    echo ""
    echo "Error: $TOKEN"
    echo ""
    echo "💡 Alternative: Try getting token for default Microsoft Graph:"
    echo ""

    GRAPH_TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>&1)

    if [ $? -eq 0 ] && [ ! -z "$GRAPH_TOKEN" ]; then
        echo "✅ Got Graph token instead (may work for testing):"
        echo ""
        echo "$GRAPH_TOKEN"
        echo ""
    else
        echo "❌ That didn't work either."
        echo ""
        echo "📝 Manual alternative - Get token via browser:"
        echo ""
        echo "1. Visit this URL in your browser:"
        echo "   https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/authorize?client_id=$CLIENT_ID&response_type=token&redirect_uri=http://localhost:3001&scope=openid%20profile%20email"
        echo ""
        echo "2. Sign in and approve"
        echo "3. Copy the access_token from the URL"
        echo ""
    fi
fi
