#!/bin/bash
HOOK_TYPE="$1"
BRIDGE_URL="${BRIDGE_URL:-http://bridge:8081}"

# Read context from stdin
CONTEXT=$(cat)

# Simple message extraction without jq for robustness
case "$HOOK_TYPE" in
    notification)
        TITLE="Claude Code Notification"
        BODY="Task update from Claude Code"
        ;;
    stop)
        TITLE="Task Completed"
        BODY="Claude Code has finished the task"
        ;;
    permission_request)
        TITLE="Permission Required"
        BODY="Action requires your approval"
        ;;
esac

curl -s -X POST "${BRIDGE_URL}/api/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hookType\":\"$HOOK_TYPE\",\"title\":\"$TITLE\",\"body\":\"$BODY\"}"
