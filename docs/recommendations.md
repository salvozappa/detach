# Recommendations

Code review notes and improvement recommendations. Prioritized by impact.

## Security Fixes

### Replace shell string construction with exec.Command args
**Files:** `bridge/internal/git/git.go`, `bridge/internal/files/files.go`

Git and file operations construct shell commands via string concatenation and pass them through `sh -c`. Even with single-quote escaping, this is fragile and risks command injection if a filename bypasses the escaping logic.

**Fix:** Use `exec.Command()` with separate arguments instead of building shell strings. For example:
```go
// Before (risky)
cmd := fmt.Sprintf("git diff -- '%s'", escapeSingleQuotes(file))
executor.Execute("sh", "-c", cmd)

// After (safe)
executor.Execute("git", "diff", "--", file)
```

### Add git operation timeouts
**Files:** `bridge/internal/git/git.go`

`git pull` and `git push` can hang indefinitely on network issues. Wrap these calls with `context.WithTimeout` (e.g. 60 seconds).

### Add rate limiting on WebSocket auth
**File:** `bridge/main.go`

No rate limiting on authentication attempts. Add IP-based rate limiting (e.g. 10 attempts/minute) to prevent brute-force token guessing.

### Add Content Security Policy headers
**File:** `webview/nginx.conf`

Add strict CSP headers to harden against XSS.

## Code Quality

### Replace brittle ls parsing with Go stdlib
**File:** `bridge/internal/files/files.go`

`ls -la` output parsing breaks with locale changes. Use `os.ReadDir()` or `filepath.Walk()` instead, which are portable and don't depend on shell output formatting.

### Remove private xterm.js API usage
**File:** `webview/src/ui/terminal.ts`

Accesses `_core._renderService` for scroll calculations. This will break silently on xterm.js upgrades. Find an alternative using the public API or submit an upstream feature request.

### Split terminal.ts into focused modules
**File:** `webview/src/ui/terminal.ts` (862 lines)

Extract into separate modules: touch scroll / momentum physics, multi-line link provider, viewport / keyboard handling.

## Testing

### Add integration tests for WebSocket protocol
Test the full message flow: connect, authenticate, send terminal data, receive output, git operations. Use gorilla/websocket's test server utilities.

### Improve frontend test coverage
Test runner and test helpers exist but coverage is thin. Priority targets: connection state machine, diff processing in utils.ts, git/file operation logic.

## Features

### Search in Code view
File browsing works but there's no way to search file contents. Backend could use `git grep` or `ripgrep`, surface results in the Code panel.

### Commit history viewer
Git panel only shows current working tree changes. Add a `git log` viewer to browse commit history.

### Branch switching
Currently locked to whatever branch is checked out. Add a branch selector in the Git panel.

## Performance

### Reduce terminal scrollback
**File:** `webview/src/ui/terminal.ts`

Scrollback is set to 100,000 lines. On mobile devices with limited memory, 10,000 is more reasonable and still generous.

### Add request debouncing for file operations
Multiple rapid file/directory requests each spawn separate SSH commands. Debounce or coalesce these on the backend.

## Observability

### Add structured logging
Current logging is unstructured `log.Printf`. Switch to structured logging (e.g. `slog` in Go stdlib) for easier filtering and aggregation.

### Add runtime validation for WebSocket messages
Frontend trusts message shapes from the server without runtime checks. Add validation (e.g. zod) to catch protocol mismatches early instead of failing silently.
