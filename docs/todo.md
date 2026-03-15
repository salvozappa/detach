# TODO

Pre-launch and post-launch improvements. See also [recommendations.md](recommendations.md) for code-level improvements.

## Pre-launch

- [ ] Validate WebSocket Origin header against configured domain (`bridge/main.go`)
- [ ] Remove build artifacts from git (`webview/dist/`) and add to `.gitignore`
- [ ] Add `.DS_Store` to `.gitignore`

## Post-launch

- [ ] Add `SECURITY.md` with vulnerability reporting instructions
- [ ] Add GitHub Actions CI (TypeScript type checking, Go tests, Docker build verification)
- [ ] Refactor shell command construction to use `exec.Command` with args (see recommendations.md)
- [ ] Add rate limiting on WebSocket auth attempts
