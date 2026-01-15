# Detach.it - Context Reference

## Project Vision
This is a mobile-first "asyncronous coding" app with 4 panels: LLM (terminal with CLI LLM assistant running), Code (file browser (read only)), Terminal (standard bash shell), Git (version control UI to commit / pull / push).

**Core workflow:**
1. Queue up coding tasks from your phone, in the LLM view
2. AI agent executes in cloud sandbox
3. Get push notification when complete
4. Review changes in mobile-optimized UI
5. Approve/reject/request changes

See `docs/concept.md` for full vision and business model.

## Current Implementation
Web-based terminal + Git UI prototype. Four-panel interface:

### Bottom Navigation Panels
1. **LLM** - Terminal with Claude Code (or another CLI assistant) running in the sandbox
2. **Code** - File browser for viewing project files with syntax highlighting
3. **Terminal** - Standard bash shell for running applications, tests, and commands
4. **Git** - Git status viewer for reviewing and committing changes

Users can connect via browser or the native Android app to interact with a remote sandbox environment.

## Architecture
- **Frontend (webview/)**: HTML/CSS/JS served via nginx
- **Android (android/)**: Native Android app with WebView wrapper
- **Backend (bridge/)**: Go WebSocket server that bridges browser ↔ SSH sandbox
- **Sandbox**: Ubuntu container with SSH, dev tools, git

## UI Features by Panel

### LLM Panel
- xterm.js terminal connected to sandbox
- Mobile keyboard toolbar (Esc, arrows, Enter)
- Session persistence (reconnects to same shell)
- Visual viewport handling for mobile keyboard

### Code Panel
- File explorer with folder navigation
- Syntax-highlighted code viewer (powered by highlight.js)
- Touch-friendly file browsing

### Git Panel
- Accordion sections: Unstaged Changes / Staged Changes
- Inline diff viewer with syntax highlighting
- Actions: Stage, Unstage, Discard (double-tap confirm)
- Commit button (enabled when changes staged)
- Untracked files: Clean syntax highlighting, no diff indicators
- Tracked files: Traditional diff view with +/- and red/green backgrounds

### Terminal Panel
- Standard bash shell for direct command execution
- Runs independently from LLM terminal
- Full xterm.js terminal with keyboard toolbar support
- Session persistence (reconnects to same shell)
- Ideal for running apps, tests, build commands, etc.


## Key Files

### Frontend
- `webview/index.html` - Main HTML structure
- `webview/app.js` - WebSocket client, terminal UI, git rendering logic
- `webview/styles.css` - All styling including git diff display

### Backend
- `bridge/server.go` - Main WebSocket server
- `bridge/bridge.go` - Connection handling
- `bridge/session.go` - SSH session management
- `bridge/terminal.go` - PTY/terminal handling
- `bridge/git.go` - Git operations (status, stage, unstage, discard)
- `bridge/types.go` - Go struct definitions for WebSocket messages
- `bridge/Dockerfile` - Multi-stage build (copies all *.go files)

### Android
- `android/app/src/main/java/it/detach/app/MainActivity.kt` - Main activity with WebView
- `android/app/src/main/AndroidManifest.xml` - App manifest (permissions, config)
- `android/app/src/main/res/values/strings.xml` - App name and strings
- `android/app/build.gradle.kts` - App-level build config
- `android/gradle/libs.versions.toml` - Dependency versions

## Build

The webview container loads the HTML/CSS via mounted volumes, so it doesn't
require restarting.
The `bridge` container does requires rebuilding for recompilation.

```bash
# Rebuild both containers
docker-compose build --no-cache bridge webview
docker-compose up -d

# Or individually
docker-compose build --no-cache bridge
docker-compose up -d bridge

docker-compose build --no-cache webview
docker-compose up -d webview
```

### Android App

In `android/` there is an app, which is a native WebView wrapper that connects to
the hosted web app.

To change the server URL, edit `MainActivity.kt` and update the URL in the
`DetachWebView` call.

## WebSocket Protocol

### Terminal Messages
```javascript
// Terminal input/output with routing
{
  type: 'terminal_data',
  terminal: 'llm' | 'terminal',  // Route to LLM or shell terminal
  data: '<base64-encoded-data>'
}

// Terminal resize
{
  type: 'resize',
  terminal: 'llm' | 'terminal',
  rows: 24,
  cols: 80
}
```

### Git Messages
```javascript
// Request
{ type: 'git_status' }
{ type: 'git_stage', file: 'path/to/file' }
{ type: 'git_unstage', file: 'path/to/file' }
{ type: 'git_discard', file: 'path/to/file' }

// Response
{
  type: 'git_status',
  unstaged: [{ path, diff, added, removed, isUntracked }],
  staged: [{ path, diff, added, removed, isUntracked }]
}
```

## Common Tasks

### Modify Git View Rendering
1. Update `webview/app.js` → `renderFileChange()` function
2. Update `webview/styles.css` for styling
3. No need to rebuild

### Modify Git Backend Logic
1. Update `bridge/git.go` → `getGitStatus()` or action functions
2. Update `bridge/types.go` if changing message structure
3. Rebuild bridge: `docker-compose build --no-cache bridge && docker-compose up -d bridge`

### Apply Changes
- Restart container locally: `docker compose down && docker compose up --build -d`

## Port Mappings
- 8080 → webview (nginx)
- 8081 → bridge (WebSocket)
- 2222 → sandbox (SSH)
- 5432 → postgres (not used by detach.it currently)

## Environments

- **Local environment**: Defined in `docker-compose.yml`
- **Remote instance environment**:
  - Defined in `docker-compose.prod.yml`
  - Running in a VPS. Provisioning defined in `infrastructure/vps-config-init.yaml`
  - Deploy local changes and restart remote instance: `infrastructure/deploy-to-vps.sh --rsync`
  - More information in `infrastructure/README.md`

## Debugging

You have full ssh access to the remote machine where the nightly instance is hosted, at the FQDN nightly01.tail5fb253.ts.net. You can access the docker containers and their logs for debugging purposes.

You can ask the human in the loop for any webview frontend logs, investigation, HAR traces, or to interact with the android app to generate logs.

### Debug Logging Infrastructure

The codebase has comprehensive debug logging across all layers:

#### Android Logcat (MainActivity.kt)
- **Tag `DetachActivity`**: Lifecycle events (onCreate, onStart, onResume, onPause, onStop, onDestroy)
- **Tag `WV:*`**: WebView logs routed from JavaScript via `WebAppInterface`
- **Tag `WV:Console`**: Browser console.log/error/warn captured via `WebChromeClient`

#### Frontend Debug Logging (app.js)
Categories controlled by `DEBUG` object at top of file:
- **WS**: WebSocket connection events, state transitions, close codes
- **HEALTH**: Health check ticks, pong receipts, stale detection
- **VISIBILITY**: Page visibility changes
- **ANDROID**: Android lifecycle events received via custom events

WebSocket close codes are decoded:
- 1000: Normal closure
- 1001: Going away (browser/tab closing)
- 1006: Abnormal closure (no close frame) - common culprit for connection issues
- 1005: No status received

#### Backend Debug Logging (bridge/)
- **`[WS]`**: Connection attempts, upgrades, session creation (server.go)
- **`[WS:<session-id>]`**: Per-session events, ping/pong, close codes (bridge.go)

### Viewing Logs

**Android app (via adb):**
```bash
# All relevant logs
adb logcat -s DetachActivity:* WV:*:*

# Filter by specific tag
adb logcat -s WV:WS:*
```

**Backend (bridge container):**
```bash
# All bridge logs
docker logs -f detach-bridge

# Filter WebSocket events only
docker logs -f detach-bridge 2>&1 | grep '\[WS'

# Filter specific session
docker logs detach-bridge 2>&1 | grep 'abc123'
```

**Remote nightly instance:**
```bash
ssh nightly01.tail5fb253.ts.ne "docker logs -f detach-bridge 2>&1 | grep '\[WS'"
```

### Debugging WebSocket Connection Issues

1. **Start log capture** before reproducing:
   ```bash
   # Terminal 1 - Android
   adb logcat -s DetachActivity:* WV:*:*

   # Terminal 2 - Backend
   docker logs -f detach-bridge 2>&1 | grep '\[WS'
   ```

2. **Expected sequence (normal resume):**
   ```
   DetachActivity: onPause
   WV:VISIBILITY: Page hidden
   WV:HEALTH: Stopping health check
   (app backgrounded)
   DetachActivity: onResume
   WV:ANDROID: Android onResume received
   WV:VISIBILITY: Page visible
   WV:WS: Connection check
   WV:HEALTH: Starting health check
   ```

3. **Reconnect loop pattern to watch for:**
   ```
   WV:WS: WebSocket closed {code: 1006, wasClean: false}
   WV:WS: Scheduling reconnect
   WV:WS: Starting connection
   WV:WS: WebSocket opened
   WV:WS: WebSocket closed {code: 1006}  <- immediately closes again
   ```

### Correlation IDs

Frontend generates `conn-{timestamp}-{counter}` correlation IDs for each connection attempt. These appear in the `corrId` field of JSON log entries and can be used to track a single connection attempt across logs.

## Development workflow
Don't worry about git. All git commands will be executed by the human in the loop.
