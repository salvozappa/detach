# Push Notifications

This document describes how push notifications work in detach.it.

## Overview

Push notifications are triggered by Claude Code hooks and delivered to the **PWA (browser)** via Web Push (VAPID).

When Claude Code emits certain events (Stop, PermissionRequest), a hook script in the sandbox notifies the bridge, which then sends push notifications to all registered devices.

## Architecture

```
[PWA Startup]
    |
    | (WebSocket: register_web_push)
    v
[Bridge: stores subscriptions]

[Sandbox: Claude Code]
    |
    | (hook fires)
    v
[Sandbox: notify-hook.sh]
    |
    | (HTTP POST to /api/hook)
    v
[Bridge: notifications.go]
    |
    └─> [Web Push] VAPID Protocol ──> [PWA Service Worker]
```

**Key Points:**
- Subscription registration happens via WebSocket (same connection used for terminal)
- Hook notifications use HTTP POST from sandbox to bridge
- Uses Web Push protocol with VAPID keys

## Configuration

### Web Push Setup

Web Push uses VAPID (Voluntary Application Server Identification) keys for authentication.

1. **Generate VAPID keys** (one-time):
   ```bash
   npx web-push generate-vapid-keys
   ```

2. **Add keys to `.env` file** in project root:
   ```
   VAPID_PUBLIC_KEY=BG5FQWU0HWKoUaChlDNI2uWFf5C_WUCw21DeULHmw6RFyYUJ5MMcaTF61GMSonvu_D0rpFQJjV7r-u60xKjLSvk
   VAPID_PRIVATE_KEY=IVIDiCCP6oh0oLDWc4MHKKdPwFnfsjtq5vHoEaoPX24
   VAPID_SUBJECT=mailto:admin@detach.it
   ```

3. **Add public key to `webview/index.html`**:
   ```html
   <meta name="vapid-public-key" content="BG5FQWU0HWKoUaChlDNI2uWFf5C_...">
   ```

4. Subscriptions are persisted to `/app/data/web-push-subscriptions.json` (via Docker volume)

### Environment Variables

The bridge uses the following environment variables for Web Push:

```
VAPID_PUBLIC_KEY=<your-public-key>
VAPID_PRIVATE_KEY=<your-private-key>
VAPID_SUBJECT=mailto:admin@detach.it
WEB_PUSH_SUBSCRIPTIONS_FILE=/app/data/web-push-subscriptions.json
```

In `docker-compose.yml`:
```yaml
bridge:
  environment:
    - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
    - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
    - VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@detach.it}
    - WEB_PUSH_SUBSCRIPTIONS_FILE=/app/data/web-push-subscriptions.json
  volumes:
    - bridge-data:/app/data
```

### Sandbox Hooks

Claude Code hooks are configured in the **project directory** (not globally), so they travel with your code.

The hooks configuration is automatically provisioned at `~/project/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/home/detach-dev/scripts/notify-hook.sh stop"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/home/detach-dev/scripts/notify-hook.sh permission_request"
          }
        ]
      }
    ]
  }
}
```

**Note:** We only hook `Stop` and `PermissionRequest` because:
- `Stop`: Signals task completion - you need to review the results
- `PermissionRequest`: Requires your approval to proceed
- `Notification` (not used): General progress updates - too frequent and not actionable

The hook notification script at `/home/detach-dev/scripts/notify-hook.sh`:

```bash
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
```

**Note:** These files are automatically provisioned by the sandbox Dockerfile and entrypoint script, so they're created when the container builds.

## WebSocket Messages

### register_web_push

Sent by the PWA when the user grants notification permission.

**Message:**
```json
{
  "type": "register_web_push",
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "BNcRd...",
      "auth": "tBHI..."
    }
  }
}
```

**Response:**
```json
{
  "type": "web_push_registered",
  "status": "ok"
}
```

## API Endpoints

### POST /api/hook

Receive hook notifications from the sandbox and send push notifications.

**Request:**
```json
{
  "hookType": "stop",
  "title": "Task Completed",
  "body": "Claude Code has finished the task"
}
```

**Response:**
```json
{"status": "ok"}
```

## Hook Types

| Hook Type | Trigger | Default Title | Description |
|-----------|---------|---------------|-------------|
| `stop` | Task completes or Claude Code stops | "Task Completed" | Indicates the task has finished - time to review |
| `permission_request` | Tool requires approval | "Permission Required" | User needs to approve an action - requires response |

**Note:** The `notification` hook type is available but not configured, as it fires too frequently for general progress updates and is not actionable.

## Debugging

### Check Web Push Subscription

**Browser DevTools > Application > Service Workers:**
- Verify service worker is "activated and running"
- Check Push section for subscription status

**Frontend logs (browser console):**
```
WV:WS: registerWebPush called
WV:WS: Created new Web Push subscription
WV:WS: Registering Web Push subscription via WebSocket
```

**Bridge logs:**
```
[WebPush] Session abc123 registering web push subscription
[WebPush] Registered subscription for session abc123
```

### Check Web Push Delivery

```
[HOOK] Received stop hook: title="Task Completed", body="..."
[WebPush] Sent notification to session abc123 (hook=stop, title="Task Completed")
```

### Troubleshooting

1. **VAPID keys not configured:**
   - Check `.env` file has `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
   - Check `webview/index.html` has the public key in meta tag
   - Check bridge logs for "[WebPush] VAPID keys not configured"

2. **Permission denied:**
   - User must grant notification permission when prompted
   - Check browser settings if permission was previously denied

3. **Subscription expired (410 Gone):**
   - Subscriptions expire if unused for extended periods
   - Bridge automatically removes expired subscriptions
   - User will be re-subscribed on next visit

4. **Service worker not registered:**
   - Check DevTools > Application > Service Workers
   - Ensure HTTPS is being used (required for service workers)

5. **Hook not triggering:**
   - Verify `~/project/.claude/settings.json` exists in the sandbox
   - Check that `/home/detach-dev/scripts/notify-hook.sh` is executable
   - Test the hook script manually:
     ```bash
     echo '{"message":"test"}' | /home/detach-dev/scripts/notify-hook.sh notification
     ```
   - Check bridge logs for incoming hook requests
