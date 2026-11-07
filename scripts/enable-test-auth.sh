#!/bin/bash

# Enable Authentication on Test Route
# This script modifies routes/api.js to enable authentication on /api/templates endpoint

echo ""
echo "🔐 Enabling Authentication on Test Route"
echo "=========================================="
echo ""

# Check if routes/api.js exists
if [ ! -f "routes/api.js" ]; then
  echo "❌ Error: routes/api.js not found!"
  echo "   Please run this script from the project root directory."
  exit 1
fi

# Backup the file
cp routes/api.js routes/api.js.backup
echo "✅ Created backup: routes/api.js.backup"

# Check if middleware is already uncommented
if grep -q "^const { requireAuth" routes/api.js; then
  echo "✅ Auth middleware already imported"
else
  # Uncomment the middleware import
  echo "✅ Uncommenting auth middleware import..."
  sed -i.tmp "s|// const { requireAuth, optionalAuth, requireRole }|const { requireAuth, optionalAuth, requireRole }|g" routes/api.js
  rm -f routes/api.js.tmp
fi

echo ""
echo "📝 Next step: Add requireAuth to a route manually"
echo ""
echo "Example change in routes/api.js:"
echo ""
echo "Before:"
echo "  router.get('/templates', async (req, res) => {"
echo ""
echo "After:"
echo "  router.get('/templates', requireAuth, async (req, res) => {"
echo ""
echo "Or use this sed command:"
echo "  sed -i '' \"s|router.get('/templates', async|router.get('/templates', requireAuth, async|\" routes/api.js"
echo ""
echo "Then restart your server:"
echo "  npm start"
echo ""
echo "📖 Full testing guide: docs/entra-id-postman-testing.md"
echo ""
