# Detach.it - Context Reference

## Project Vision
Mobile-first application for managing AI coding agents (Claude Code) asynchronously. The key insight: this isn't "coding on mobile" - it's **managing a junior dev from your phone**.

**Core workflow:**
1. Queue up coding tasks from your phone
2. AI agent executes in cloud sandbox
3. Get push notification when complete
4. Review diff in mobile-optimized UI
5. Approve/reject/request changes

See `docs/concept.md` for full vision and business model.

## Current Implementation
Web-based terminal + Git UI prototype. Three-panel interface:

### Bottom Navigation Panels
1. **LLM** - Terminal with Claude Code running in the sandbox
2. **Code** - File browser for viewing project files with syntax highlighting
3. **Git** - Git status viewer for reviewing and committing changes

Users connect via browser to interact with a remote sandbox environment.

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
- **Untracked files**: Clean syntax highlighting, no diff indicators
- **Tracked files**: Traditional diff view with +/- and red/green backgrounds

## Key Files

### Frontend
- `webview/index.html` - Main HTML structure
- `webview/app.js` - WebSocket client, terminal UI, git rendering logic
- `webview/styles.css` - All styling including git diff display
- `webview/Dockerfile` - Copies HTML/CSS/JS to nginx

### Backend
- `bridge/server.go` - Main WebSocket server
- `bridge/bridge.go` - Connection handling
- `bridge/session.go` - SSH session management
- `bridge/terminal.go` - PTY/terminal handling
- `bridge/git.go` - Git operations (status, stage, unstage, discard)
- `bridge/types.go` - Go struct definitions for WebSocket messages
- `bridge/Dockerfile` - Multi-stage build (copies all *.go files)

## Git View Features (Recently Implemented)

### Phase 1
- Syntax highlighting on all diff lines (added/removed/context)
- Diff metadata headers hidden (`---`, `+++`, `@@`)

### Phase 2
- **Untracked files**: Render as clean syntax-highlighted code (no `+` prefix, no green background)
- **Tracked files**: Keep diff indicators (`+`/`-` prefix, red/green backgrounds)
- Fixed double prefix bug on empty lines

### Key Implementation Details
- `GitFileChange.IsUntracked` field distinguishes untracked from tracked files
- Backend stores raw content (no prefix) for untracked files
- Frontend applies conditional rendering based on `isUntracked` flag
- Syntax highlighting uses highlight.js with custom line-splitting logic

## Build & Deploy

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
3. Rebuild webview: `docker-compose build --no-cache webview && docker-compose up -d webview`

### Modify Git Backend Logic
1. Update `bridge/git.go` → `getGitStatus()` or action functions
2. Update `bridge/types.go` if changing message structure
3. Rebuild bridge: `docker-compose build --no-cache bridge && docker-compose up -d bridge`

### Test Changes
- Hard refresh browser: `Cmd/Ctrl + Shift + R`
- Check browser console for JS errors (F12)
- Check docker logs: `docker logs detach-bridge` or `docker logs detach-webview`

## Port Mappings
- 8080 → webview (nginx)
- 8081 → bridge (WebSocket)
- 2222 → sandbox (SSH)
- 5432 → postgres (not used by detach.it currently)
