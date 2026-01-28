#!/bin/bash
# Trigger a test push notification on the nightly instance
#
# Usage:
#   ./scripts/test-notification.sh
#   ./scripts/test-notification.sh permission_request   # different hook type

HOOK_TYPE="${1:-stop}"
TITLE="Test Notification"
BODY="This is a test notification triggered at $(date '+%H:%M:%S')"

echo "Sending $HOOK_TYPE notification to nightly..."

ssh nightly01.tail5fb253.ts.net "curl -s -X POST 'http://localhost:8081/api/hook' \
    -H 'Content-Type: application/json' \
    -d '{\"hookType\":\"$HOOK_TYPE\",\"title\":\"$TITLE\",\"body\":\"$BODY\"}'"

echo ""
echo "Done. Check your device for the notification."
