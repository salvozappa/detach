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

### Test Changes
- You can restart containers if needed
- You can check the logs: `docker logs detach-bridge` or `docker logs detach-webview`
- Manual testing is done by me, the human, for now
- Just ask me the tests you want me to manually execute once you're done with the
  changes
- We will implement some automated testing soon
- Hard refresh browser: `Cmd/Ctrl + Shift + R`
- Check browser console for JS errors (F12)


## Port Mappings
- 8080 → webview (nginx)
- 8081 → bridge (WebSocket)
- 2222 → sandbox (SSH)
- 5432 → postgres (not used by detach.it currently)

## Development workflow
Don't worry about git. All git commands will be executed by the human in the loop.
