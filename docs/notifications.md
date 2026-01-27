# Push Notifications

This document describes how push notifications work in detach.it.

## Overview

Push notifications are triggered by Claude Code hooks and delivered to both:
- **Android app** via Firebase Cloud Messaging (FCM)
- **PWA (browser)** via Web Push (VAPID)

When Claude Code emits certain events (Stop, PermissionRequest), a hook script in the sandbox notifies the bridge, which then sends push notifications to all registered devices.

## Architecture

```
[Android App / PWA Startup]
    |
    | (WebSocket: register_fcm_token / register_web_push)
    v
[Bridge: stores tokens/subscriptions]

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
    ├─> [FCM] Firebase Cloud Messaging ──> [Android App]
    |
    └─> [Web Push] VAPID Protocol ──> [PWA Service Worker]
```

**Key Points:**
- Token/subscription registration happens via WebSocket (same connection used for terminal)
- Hook notifications use HTTP POST from sandbox to bridge
- Android: Uses Firebase Admin SDK with service account credentials
- PWA: Uses Web Push protocol with VAPID keys

## Configuration

### Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Add an Android app with package name `it.detach.app`
3. Download `google-services.json` and place it in `android/app/`
4. Create a service account for FCM (via Cloud Shell or Console):

```bash
# Set your Firebase project ID
PROJECT_ID="your-project-id"

# Create service account
gcloud iam service-accounts create fcm-notifier \
    --display-name="FCM Notification Service" \
    --project=$PROJECT_ID

# Grant FCM admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:fcm-notifier@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/firebasecloudmessaging.admin"

# Generate key file
gcloud iam service-accounts keys create fcm-service-account.json \
    --iam-account=fcm-notifier@${PROJECT_ID}.iam.gserviceaccount.com
```

5. Move `fcm-service-account.json` to the `keys/` directory (gitignored)

### Web Push Setup (PWA)

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

The bridge uses the following environment variables:

**FCM (Android):**
```
FCM_SERVICE_ACCOUNT_PATH=/app/keys/fcm-service-account.json
```

**Web Push (PWA):**
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
    - FCM_SERVICE_ACCOUNT_PATH=/app/keys/fcm-service-account.json
    - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
    - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
    - VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@detach.it}
    - WEB_PUSH_SUBSCRIPTIONS_FILE=/app/data/web-push-subscriptions.json
  volumes:
    - ./keys/fcm-service-account.json:/app/keys/fcm-service-account.json:ro
    - bridge-data:/app/data
```

### Sandbox Hooks

Claude Code hooks are configured in the **project directory** (not globally), so they travel with your code.

The hooks configuration is automatically provisioned at `~/projects/notestash/.claude/settings.json`:

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

### register_fcm_token (Android)

Sent by the Android app when it obtains an FCM token.

**Message:**
```json
{
  "type": "register_fcm_token",
  "token": "fcm-device-token..."
}
```

**Response:**
```json
{
  "type": "fcm_token_registered",
  "status": "ok"
}
```

### register_web_push (PWA)

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

## Foreground Suppression

Notifications are suppressed when the app is in the foreground (actively being used). This prevents redundant notifications when the user is already looking at Claude's output.

### Implementation

The Android app tracks foreground state via `MainActivity.isAppInForeground`:
- Set to `true` in `onResume()`
- Set to `false` in `onPause()`

In `DetachMessagingService.onMessageReceived()`, we check this flag and skip showing the notification if the app is active:

```kotlin
if (MainActivity.isAppInForeground) {
    Log.d(TAG, "App is in foreground, skipping notification")
    return
}
```

### Known Edge Case: Delayed FCM Delivery

FCM data messages may be batched or delayed by Android (especially during Doze mode). This can cause notifications to arrive after the app is backgrounded, even if the underlying event occurred while the app was in the foreground.

**Example scenario:**
1. User is viewing the app (foreground)
2. Claude completes a task, server sends FCM
3. FCM delivery is delayed by Android
4. User backgrounds the app
5. FCM message arrives, `isAppInForeground=false`, notification shows

This is generally acceptable since the delay is usually short (seconds). If this becomes problematic, the fix would be:

1. **Server side**: Include event timestamp in FCM data payload
   ```go
   Data: map[string]string{
       "hookType":  hookType,
       "title":     title,
       "body":      body,
       "timestamp": fmt.Sprintf("%d", time.Now().UnixMilli()),
   },
   ```

2. **Android side**: Track when app went to background and compare
   ```kotlin
   companion object {
       @Volatile var isAppInForeground = false
       @Volatile var lastBackgroundedAt: Long = 0
   }

   // In onPause():
   lastBackgroundedAt = System.currentTimeMillis()

   // In onMessageReceived():
   val eventTime = message.data["timestamp"]?.toLongOrNull() ?: 0
   if (eventTime < MainActivity.lastBackgroundedAt) {
       Log.d(TAG, "Event occurred while app was in foreground, skipping")
       return
   }
   ```

## Android Permissions

The app requires the `POST_NOTIFICATIONS` permission (Android 13+). This permission is requested at app startup.

## Notification Channels

A single notification channel is used:
- **ID:** `claude_hooks`
- **Name:** "Claude Code Updates"
- **Importance:** High (shows heads-up notification)

## Debugging

### Check FCM Token Registration

**Frontend logs (via adb logcat):**
```
WV:WS: registerFcmToken called
WV:WS: FCM token from Android: dG-YMDLSTGaXttRDEiei...
WV:WS: Registering FCM token via WebSocket
```

**Bridge logs:**
```
[FCM] Session abc123 registering FCM token via WebSocket: dFVpKz1...
[FCM] Registered token for session abc123
```

### Check Hook Reception

```
[HOOK] Received stop hook: title="Task Completed", body="Claude Code has finished the task"
[FCM] Sent notification to session abc123 (hook=stop, title="Task Completed")
```

### Android Logs

```bash
adb logcat -s DetachFCM:* DetachActivity:*
```

Look for:
```
D/DetachFCM: New FCM token: dFVpKz1...
D/DetachFCM: Message received from: ...
D/DetachFCM: Hook notification: type=stop, title=Task Completed, body=...
D/DetachFCM: Notification shown: id=1234567890
```

## Troubleshooting

### Notifications not showing

1. Check that `FCM_SERVICE_ACCOUNT_PATH` is set in the bridge environment
2. Verify the service account JSON file exists at the specified path
3. Verify the FCM token is registered (check bridge logs)
4. Check that notification permission is granted on the device
5. Ensure the notification channel exists (created at app startup)

### Hook not triggering

1. Verify `~/projects/notestash/.claude/settings.json` exists in the sandbox
2. Check that `/home/detach-dev/scripts/notify-hook.sh` is executable
3. Test the hook script manually:
   ```bash
   echo '{"message":"test"}' | /home/detach-dev/scripts/notify-hook.sh notification
   ```
4. Check bridge logs for incoming hook requests

### FCM errors

1. Verify `google-services.json` is in `android/app/`
2. Check that the Firebase project has Cloud Messaging enabled
3. Ensure the service account has the correct IAM role (`roles/firebasecloudmessaging.admin`)
4. Check bridge logs for Firebase Admin SDK initialization errors

### Token not registering

1. Check that the WebSocket connection is established (look for session ID in logs)
2. Verify the Android app is calling `Android.getFcmToken()` successfully
3. Check frontend logs: look for "Registering FCM token via WebSocket"
4. Check bridge logs: look for "[FCM] Session ... registering FCM token via WebSocket"

## Web Push (PWA) Debugging

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

### Web Push Troubleshooting

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
