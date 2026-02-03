# Detach.it

Mobile-first terminal and Git UI for managing AI coding agents asynchronously.

## Description

A web-based interface that connects to a remote sandbox where AI agents (like Claude Code) execute coding tasks. Features a four-panel mobile-optimized interface:

1. **LLM** - Interactive terminal with Claude Code AI assistant
2. **Code** - Read-only file browser with syntax highlighting
3. **Terminal** - Standard bash shell for running apps and commands
4. **Git** - Visual Git UI for staging, committing, pulling, and pushing changes

## Components

- **Webview** - Frontend (HTML/CSS/JS) with xterm.js terminal and Git UI
- **Bridge** - Go WebSocket server that connects browser to sandbox
- **Sandbox** - Ubuntu container with SSH, development tools, and Git

## Prerequisites

- Docker & Docker Compose
- SSH key pair in `keys/bridge` and `keys/bridge.pub`
- `make` (for development setup)

## Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd detach.it

# Generate SSH keys if needed
mkdir -p keys
ssh-keygen -t rsa -b 4096 -f keys/bridge -N ""

# Start all services
docker-compose up -d

# Access the UI
open http://localhost:8080
```

## Ports

- `8080` - Web UI
- `8081` - WebSocket bridge
- `2222` - Sandbox SSH (for debugging)

## Development

### Setup

After cloning, run the following to install git hooks (pre-commit linting and tests):

```bash
make setup
```

### Rebuild and Debug

```bash
# Rebuild after changes
docker-compose build --no-cache bridge webview
docker-compose up -d

# View logs
docker logs detach-bridge
docker logs detach-webview
docker logs detach-sandbox

# SSH into sandbox for debugging
ssh -i keys/bridge -p 2222 detach-dev@localhost
```

## Architecture

```
Browser (xterm.js)
    ↓ WebSocket
Bridge (Go)
    ↓ SSH
Sandbox (Ubuntu + dev tools)
```

## VPS Deployment

For deploying to a VPS for nightly testing or production:

### Provision infrastructure
1. **Provision VPS** with `infrastructure/vps-config-init.yaml` as cloud-init
2. **Setup Tailscale**: `ssh sal@<vps-ip> && sudo tailscale up`
3. **Setup GitHub Deploy Key**: See [infrastructure/README.md](infrastructure/README.md)

### Deploy
Run `./deploy.sh` from your local machine (supports git pull or rsync modes)

### HTTPS for PWA
To enable HTTPS (required for Progressive Web App features):
1. Enable HTTPS in [Tailscale admin](https://login.tailscale.com/admin/dns)
2. Run: `sudo tailscale serve --bg --https 443 http://localhost:8080`
3. Access at: `https://<hostname>.tail-scale.ts.net`

See [infrastructure/README.md](infrastructure/README.md) for complete deployment guide.

### Access
- **Development**: `http://localhost:8080`
- **VPS (HTTP)**: `http://<tailscale-ip>:8080`
- **VPS (HTTPS)**: `https://<hostname>.tail-scale.ts.net`
