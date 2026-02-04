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

Users can connect via browser (PWA) to interact with a remote sandbox environment.

## Architecture
- **Frontend (webview/)**: HTML/CSS/JS served via nginx
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

The frontend is written in TypeScript and built via esbuild. Source lives in `webview/src/`.

**Module Structure:**
```
webview/src/
├── app.ts              # Entry point, view orchestration, event wiring
├── connection.ts       # WebSocket lifecycle, reconnection, health checks
├── types.ts            # Type definitions, constants, configuration
├── utils.ts            # Logging infrastructure, utility functions
├── files.ts            # File operations (request/cache/notify)
├── git.ts              # Git operations (request/cache/notify)
└── ui/                 # UI layer (presentation components)
    ├── terminal.ts     # xterm.js wrapper, keyboard toolbar
    ├── code-view.ts    # File browser, syntax-highlighted viewer
    ├── git-view.ts     # Git status UI, diff viewer, staging actions
    ├── toast.ts        # Toast notifications
    └── status.ts       # Connection status display
```

**Architecture Pattern:**
- **UI layer (`ui/`)**: Presentation components that own DOM state and rendering
- **Business logic layer (root)**: Connection, file ops, git ops - no direct DOM manipulation
- **Orchestration (`app.ts`)**: Wires modules together, handles cross-cutting events

**Other Frontend Files:**
- `webview/index.html` - Main HTML structure
- `webview/styles.css` - All styling including git diff display
- `webview/dist/bundle.js` - Built output (generated)

### Backend
- `bridge/server.go` - Main WebSocket server
- `bridge/bridge.go` - Connection handling
- `bridge/session.go` - SSH session management
- `bridge/terminal.go` - PTY/terminal handling
- `bridge/git.go` - Git operations (status, stage, unstage, discard)
- `bridge/types.go` - Go struct definitions for WebSocket messages
- `bridge/Dockerfile` - Multi-stage build (copies all *.go files)

## Build

### Frontend (webview)
TypeScript source in `webview/src/` is compiled to `webview/dist/bundle.js` via esbuild:
```bash
cd webview && npm run build
```

The webview container loads files via mounted volumes, so after rebuilding
the bundle, changes are live (no container restart needed).

### Backend (bridge)
The `bridge` container requires rebuilding for Go recompilation.

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
1. Update `webview/src/ui/git-view.ts` for rendering logic
2. Update `webview/styles.css` for styling
3. Run `npm run build` in `webview/` to rebuild

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
  - Deploy from local machine: `./deploy.sh` (git mode) or `./deploy.sh --rsync` (rsync uncommitted changes)
  - More information in `infrastructure/README.md`

## Debugging

You have full ssh access to the remote machine where the nightly instance is hosted, at the FQDN nightly01.tail5fb253.ts.net. You can access the docker containers and their logs for debugging purposes.

You can ask the human in the loop for any webview frontend logs, investigation, or HAR traces.

### Debug Logging Infrastructure

The codebase has comprehensive debug logging across all layers:

#### Frontend Debug Logging (utils.ts)
Categories controlled by `DEBUG` object in `webview/src/utils.ts`:
- **WS**: WebSocket connection events, state transitions, close codes
- **HEALTH**: Health check ticks, pong receipts, stale detection
- **VISIBILITY**: Page visibility changes
- **NETWORK**: Network online/offline events
- **TERMINAL**: Terminal input/focus events
- **TOOLBAR**: Keyboard toolbar button events
- **FOCUS**: Document focus changes (terminal textarea only)

**WebSocket Log Forwarding (PWA):** Frontend debug logs are forwarded to the bridge server via WebSocket, making them visible in `docker logs`. This is essential for debugging PWAs where console.log doesn't appear in remote logs. Logs are queued before WebSocket connects and flushed once connected. Server-side logs appear with `[CLIENT:<category>]` prefix.

WebSocket close codes are decoded:
- 1000: Normal closure
- 1001: Going away (browser/tab closing)
- 1006: Abnormal closure (no close frame) - common culprit for connection issues
- 1005: No status received

#### Backend Debug Logging (bridge/)
- **`[WS]`**: Connection attempts, upgrades, session creation (server.go)
- **`[WS:<session-id>]`**: Per-session events, ping/pong, close codes (bridge.go)

### Viewing Logs

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
ssh nightly01.tail5fb253.ts.net "docker logs -f detach-bridge 2>&1 | grep '\[WS'"
```

**PWA frontend logs (via WebSocket forwarding):**
```bash
# All forwarded client logs
docker logs -f detach-bridge 2>&1 | grep '\[CLIENT'

# Filter by category (e.g., TOOLBAR events)
docker logs -f detach-bridge 2>&1 | grep '\[CLIENT:TOOLBAR'

# Remote nightly instance
ssh nightly01.tail5fb253.ts.net "docker logs -f detach-bridge 2>&1 | grep '\[CLIENT'"
```

### Debugging WebSocket Connection Issues

1. **Start log capture** before reproducing:
   ```bash
   docker logs -f detach-bridge 2>&1 | grep '\[WS'
   ```

2. **Expected sequence (normal resume):**
   ```
   WV:VISIBILITY: Page hidden
   WV:HEALTH: Stopping health check
   (app backgrounded)
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
No need to say or think about how to test the changes or which parts of the app need rebuilding.

### Dependencies
Always use exact versions in package.json (no `^` or `~` prefixes).
