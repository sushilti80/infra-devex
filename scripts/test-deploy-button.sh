#!/bin/bash

# Vue Deploy Button Testing Script
# This script helps verify the Deploy button behavior matches Vanilla JavaScript

echo "=========================================="
echo "Vue Deploy Button Testing"
echo "=========================================="
echo ""

echo "📋 Pre-Test Checklist:"
echo "----------------------"
echo "1. Backend running? (npm run dev)"
echo "2. Frontend running? (npm run dev:client)"
echo "3. Browser DevTools console open?"
echo "4. Ready to deploy test infrastructure?"
echo ""
read -p "Press Enter when ready to start test..."

echo ""
echo "🧪 Test Procedure:"
echo "----------------------"
echo ""

echo "Step 1: Navigate to Custom Infrastructure"
echo "  ✓ Go to http://localhost:5173"
echo "  ✓ Click 'Custom Infrastructure' button"
echo ""
read -p "Press Enter when on Custom Infrastructure page..."

echo ""
echo "Step 2: Fill Project Details (Step 1)"
echo "  ✓ Project Name: testapp"
echo "  ✓ Description: Test Application"
echo "  ✓ Environment: sand"
echo "  ✓ Owner: [your-email]"
echo "  ✓ Lifecycle: experimental"
echo "  ✓ Project Age: 30"
echo "  ✓ Click 'Next'"
echo ""
read -p "Press Enter when project details filled..."

echo ""
echo "Step 3: Select Modules (Step 2)"
echo "  ✓ Select at least one module (e.g., virtual-network)"
echo "  ✓ Click 'Next'"
echo ""
read -p "Press Enter when modules selected..."

echo ""
echo "Step 4: Configure Instances (Step 3)"
echo "  ✓ Review instance configurations"
echo "  ✓ Click 'Next'"
echo ""
read -p "Press Enter when instances configured..."

echo ""
echo "Step 5: RBAC (Step 4) - Optional"
echo "  ✓ Skip RBAC or configure if needed"
echo "  ✓ Click 'Next'"
echo ""
read -p "Press Enter when RBAC configured..."

echo ""
echo "Step 6: Review (Step 5)"
echo "  ✓ Review all settings"
echo "  ✓ Click 'Next' to deployment page"
echo ""
read -p "Press Enter when on deployment page..."

echo ""
echo "=========================================="
echo "🚀 CRITICAL STEP: Deploy Infrastructure"
echo "=========================================="
echo ""
echo "Before clicking Deploy, open Browser Console and verify:"
echo ""
echo "Expected Console Output Pattern:"
echo "--------------------------------"
echo "1. Initial deployment log:"
echo "   ------------------------------------------------------------"
echo "   DEPLOYMENT INITIATED"
echo "   Correlation ID: cid-[timestamp]-[random]"
echo "   Project: testapp"
echo "   Environment: sand"
echo "   Modules: [module-list]"
echo "   ------------------------------------------------------------"
echo ""
echo "2. Polling logs (every 10 seconds, NOT 5 seconds):"
echo "   ------------------------------------------------------------"
echo "   WORKFLOW STATUS CHECK: Looking for correlation ID: cid-..."
echo "   Timestamp: [ISO timestamp]"
echo "   ------------------------------------------------------------"
echo "   Workflow status response for cid-...: {status: 'pending', ...}"
echo ""
echo "3. Status progression:"
echo "   - First poll: {status: 'pending'} OR {status: 'queued'}"
echo "   - Next polls: {status: 'in_progress'}"
echo "   - Final poll: {status: 'completed', conclusion: 'success'}"
echo ""
echo "4. URL extraction:"
echo "   Found PR URL: https://github.com/.../pull/[number]"
echo "   Found workflow URL: https://github.com/.../runs/[id]"
echo ""
echo "5. Final status:"
echo "   ------------------------------------------------------------"
echo "   WORKFLOW STATUS RESULT: Found matching workflow run"
echo "   Correlation ID: cid-..."
echo "   Workflow URL: https://github.com/..."
echo "   Status: completed, Conclusion: success"
echo "   ------------------------------------------------------------"
echo ""
read -p "Press Enter after reviewing console output pattern..."

echo ""
echo "Now click 'Deploy Infrastructure' button"
echo ""
read -p "Press Enter after clicking Deploy..."

echo ""
echo "⏱️  Monitoring Phase (watch console):"
echo "------------------------------------"
echo ""
echo "Timer: 0:00 - Should see 'DEPLOYMENT INITIATED'"
echo "Timer: 0:10 - First status check"
echo "Timer: 0:20 - Second status check"
echo "Timer: 0:30 - Third status check"
echo "Timer: 0:40 - Fourth status check"
echo "..."
echo "(Continue every 10 seconds until complete)"
echo ""
echo "Watch for:"
echo "  ✓ Separator lines (----...)"
echo "  ✓ Correlation ID consistency"
echo "  ✓ 10-second intervals (not 5 seconds)"
echo "  ✓ Status progression: pending → in_progress → completed"
echo "  ✓ URL extraction logs"
echo "  ✓ Final success status"
echo ""

# Wait for user to confirm completion
read -p "Press Enter when workflow completes (or times out)..."

echo ""
echo "=========================================="
echo "✅ Verification Checklist"
echo "=========================================="
echo ""

# Checklist function
check_item() {
    local item="$1"
    echo -n "  $item: "
    read -p "[y/n] " answer
    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
        echo "     ✅ PASS"
        return 0
    else
        echo "     ❌ FAIL"
        return 1
    fi
}

passed=0
total=0

echo "Console Output:"
echo "---------------"
check_item "Saw 'DEPLOYMENT INITIATED' log" && ((passed++))
((total++))
check_item "Correlation ID format: cid-[timestamp]-[random]" && ((passed++))
((total++))
check_item "Polling happened every 10 seconds (not 5)" && ((passed++))
((total++))
check_item "Saw separator lines (----...)" && ((passed++))
((total++))
check_item "Status progression logged correctly" && ((passed++))
((total++))
check_item "Saw 'Found PR URL' log" && ((passed++))
((total++))
check_item "Saw 'Found workflow URL' log" && ((passed++))
((total++))
check_item "Saw 'WORKFLOW STATUS RESULT' log" && ((passed++))
((total++))

echo ""
echo "UI Verification:"
echo "----------------"
check_item "Progress bar: 0% → 20% → 30% → 40% → 60% → 100%" && ((passed++))
((total++))
check_item "Status: Ready → Deploying → Success" && ((passed++))
((total++))
check_item "PR link displayed and clickable" && ((passed++))
((total++))
check_item "Workflow link displayed and clickable" && ((passed++))
((total++))
check_item "'View Apps' button enabled" && ((passed++))
((total++))
check_item "'Deploy Another' button enabled" && ((passed++))
((total++))

echo ""
echo "Behavior Matching:"
echo "------------------"
check_item "Behavior matches Vanilla JavaScript exactly" && ((passed++))
((total++))
check_item "No unexpected errors in console" && ((passed++))
((total++))

echo ""
echo "=========================================="
echo "📊 Test Results"
echo "=========================================="
echo ""
echo "Passed: $passed / $total"

if [ $passed -eq $total ]; then
    echo ""
    echo "✅ ALL TESTS PASSED!"
    echo "The Vue Deploy button now matches Vanilla JavaScript behavior exactly."
    echo ""
    echo "Next Steps:"
    echo "  1. Deploy to staging environment"
    echo "  2. Run QA testing"
    echo "  3. Get approval for production deployment"
else
    echo ""
    echo "⚠️  SOME TESTS FAILED"
    echo "Review the failed items above and check:"
    echo "  1. srcV2/pages/CustomInfrastructurePage.vue"
    echo "  2. Console logs for debugging"
    echo "  3. Network tab for API calls"
    echo ""
    echo "Failed items: $((total - passed)) / $total"
    echo ""
    echo "Common issues:"
    echo "  - Polling interval is 5 seconds instead of 10"
    echo "  - Status checking logic is wrong"
    echo "  - URL extraction missing fallback fields"
    echo "  - Console logging format doesn't match"
fi

echo ""
echo "=========================================="
echo "📝 Test Report Saved"
echo "=========================================="
echo ""
echo "Test Date: $(date)"
echo "Tested By: $(whoami)"
echo "Test Result: $passed / $total passed"
echo ""

# Save test report
TEST_REPORT="/Users/Alex.Smith/self-service-infra/docs/test-results/deploy-button-test-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p "/Users/Alex.Smith/self-service-infra/docs/test-results"

cat > "$TEST_REPORT" << EOF
Vue Deploy Button Test Report
==============================

Date: $(date)
Tested By: $(whoami)
Environment: Development (localhost)

Test Results: $passed / $total passed

Console Output Verification:
- Deployment initiated log: $([ $passed -ge 1 ] && echo "PASS" || echo "FAIL")
- Correlation ID format: $([ $passed -ge 2 ] && echo "PASS" || echo "FAIL")
- 10-second polling interval: $([ $passed -ge 3 ] && echo "PASS" || echo "FAIL")
- Separator lines: $([ $passed -ge 4 ] && echo "PASS" || echo "FAIL")
- Status progression: $([ $passed -ge 5 ] && echo "PASS" || echo "FAIL")
- PR URL extraction: $([ $passed -ge 6 ] && echo "PASS" || echo "FAIL")
- Workflow URL extraction: $([ $passed -ge 7 ] && echo "PASS" || echo "FAIL")
- Final status log: $([ $passed -ge 8 ] && echo "PASS" || echo "FAIL")

UI Verification:
- Progress bar progression: $([ $passed -ge 9 ] && echo "PASS" || echo "FAIL")
- Status changes: $([ $passed -ge 10 ] && echo "PASS" || echo "FAIL")
- PR link display: $([ $passed -ge 11 ] && echo "PASS" || echo "FAIL")
- Workflow link display: $([ $passed -ge 12 ] && echo "PASS" || echo "FAIL")
- View Apps button: $([ $passed -ge 13 ] && echo "PASS" || echo "FAIL")
- Deploy Another button: $([ $passed -ge 14 ] && echo "PASS" || echo "FAIL")

Behavior Matching:
- Matches Vanilla JS: $([ $passed -ge 15 ] && echo "PASS" || echo "FAIL")
- No unexpected errors: $([ $passed -ge 16 ] && echo "PASS" || echo "FAIL")

Overall Status: $([ $passed -eq $total ] && echo "✅ PASS" || echo "❌ FAIL")

Notes:
------
Add any additional observations or issues below:


EOF

echo "Report saved to: $TEST_REPORT"
echo ""
echo "Test complete! 🎉"
