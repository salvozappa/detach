# Detach.it

Mobile-first terminal and Git UI for managing AI coding agents asynchronously.

## Description

A web-based interface that connects to a remote sandbox where AI agents (like Claude Code) execute coding tasks. Features a three-panel mobile-optimized interface for terminal interaction, code viewing, and Git operations.

## Components

- **Webview** - Frontend (HTML/CSS/JS) with xterm.js terminal and Git UI
- **Bridge** - Go WebSocket server that connects browser to sandbox
- **Sandbox** - Ubuntu container with SSH, development tools, and Git

## Prerequisites

- Docker & Docker Compose
- SSH key pair in `keys/dev` and `keys/dev.pub`

## Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd detach.it

# Generate SSH keys if needed
mkdir -p keys
ssh-keygen -t rsa -b 4096 -f keys/dev -N ""

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

```bash
# Rebuild after changes
docker-compose build --no-cache bridge webview
docker-compose up -d

# View logs
docker logs detach-bridge
docker logs detach-webview
docker logs detach-sandbox

# SSH into sandbox for debugging
ssh -i keys/dev -p 2222 detach-dev@localhost
```

## Architecture

```
Browser (xterm.js)
    ↓ WebSocket
Bridge (Go)
    ↓ SSH
Sandbox (Ubuntu + dev tools)
```
