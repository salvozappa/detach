# SSH Keys

This directory contains SSH key pairs used by detach.it.

## Keys

### `bridge` / `bridge.pub`
**Purpose**: Bridge-to-sandbox SSH connection

Used by the bridge service to SSH into the sandbox container. The bridge uses the private key to authenticate, and the sandbox has the public key in its `authorized_keys`.

- **Private key** (`bridge`): Mounted into the bridge container at `/app/keys/bridge`
- **Public key** (`bridge.pub`): Mounted into the sandbox at `/tmp/authorized_keys`

### `detach_dev` / `detach_dev.pub`
**Purpose**: Sandbox GitHub authentication

Used by the `detach-dev` user inside the sandbox to authenticate with GitHub for cloning and pushing to repositories under development.

- **Private key** (`detach_dev`): Mounted into sandbox at `/home/detach-dev/.ssh/id_ed25519`
- **Public key** (`detach_dev.pub`): Mounted into sandbox at `/home/detach-dev/.ssh/id_ed25519.pub`

To use this key, add the public key as a **deploy key** (with write access) on your GitHub repository:
1. Copy the contents of `detach_dev.pub`
2. Go to your repo: Settings > Deploy keys > Add deploy key
3. Enable "Allow write access" if you need to push

### `github_deploy_key` / `github_deploy_key.pub`
**Purpose**: VPS deployment - cloning/pulling the detach.it repo

Used by the deploy script to clone and pull the detach.it repository on the VPS. The script automatically syncs this key to `~/.ssh/github_deploy_key` on the VPS.

- **Private key** (`github_deploy_key`): Copied to VPS at `~/.ssh/github_deploy_key`
- **Public key** (`github_deploy_key.pub`): Must be added to the detach.it repo as a deploy key

Setup (one-time):
1. Copy the contents of `github_deploy_key.pub`
2. Go to: https://github.com/salvozappa/detach.it/settings/keys
3. Add deploy key (read-only access is sufficient)
