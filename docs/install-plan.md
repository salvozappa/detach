Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Install Script Implementation Plan

 Overview

 Create install.sh that sets up a detach.it instance for any git repository,
  replacing the current hardcoded notestash configuration.

 Files to Modify

 1. sandbox/entrypoint.sh

 Current: Hardcodes git@github.com:salvozappa/notestash.git and git user
 config
 Change: Read DETACH_REPO_URL from environment, extract repo name
 dynamically, make git user config optional

 Key changes:
 - Extract git host from URL for SSH config (support GitHub, GitLab, etc.)
 - Extract repo name from URL for project directory
 - Error if DETACH_REPO_URL not set
 - Only set git user.name/email if DETACH_GIT_NAME/DETACH_GIT_EMAIL provided

 2. docker-compose.yml

 Change: Add environment variables, update key mount paths

 sandbox:
   environment:
     - DETACH_REPO_URL=${DETACH_REPO_URL}
     - DETACH_GIT_EMAIL=${DETACH_GIT_EMAIL:-}
     - DETACH_GIT_NAME=${DETACH_GIT_NAME:-}
   volumes:
     - ./keys/deploy_key:/home/detach-dev/.ssh/id_ed25519:ro  # renamed from
  detach_dev
     - ./keys/deploy_key.pub:/home/detach-dev/.ssh/id_ed25519.pub:ro

 bridge:
   environment:
     - DETACH_TOKEN=${DETACH_TOKEN}

 3. bridge/internal/config/config.go

 Change: Add AuthToken field, change WorkingDir default to ~/projects

 4. bridge/main.go

 Change: Add token validation before WebSocket upgrade, add QR code display
 on startup

 - Validate token query param against cfg.AuthToken
 - Return 401 if invalid (before upgrade)
 - On startup, print pairing URL + QR code to logs

 5. bridge/go.mod

 Change: Add github.com/mdp/qrterminal/v3 dependency

 6. .gitignore

 Change: Add generated keys and data directory

 keys/bridge
 keys/bridge.pub
 keys/deploy_key
 keys/deploy_key.pub
 data/
 .env

 Files to Create

 1. install.sh (main script)

 Flow:
 1. Parse args (repo URL, --force flag)
 2. Validate URL format, convert HTTPS to SSH
 3. Check Docker running, ports available
 4. Generate keys if missing (ssh-keygen -t ed25519)
 5. Display deploy key + instructions, pause for user
 6. Verify repo access (git ls-remote with deploy key)
 7. Generate auth token (openssl rand -base64 32)
 8. Create .env with DETACH_REPO_URL and DETACH_TOKEN
 9. docker-compose build && docker-compose up -d
 10. Display pairing URL + QR code

 Helper functions (following deploy.sh patterns):
 - convert_to_ssh_url() - HTTPS → SSH conversion
 - extract_host_from_ssh_url() - for SSH config
 - generate_keys() - idempotent key generation
 - verify_repo_access() - test with deploy key
 - show_deploy_key_instructions() - platform-specific guidance

 2. keys/.gitkeep and data/.gitkeep

 Directory placeholders

 Key Design Decisions

 1. QR code: Generate in Go (bridge startup) using qrterminal. Also attempt
 in bash if qrencode installed.
 2. Token storage: Both .env (for docker-compose) and data/auth_token (for
 scripts/display).
 3. Git user config: Optional via env vars. Don't prompt - keeps install
 simple.
 4. Idempotency: Keys skipped if exist. --force regenerates everything.

 Verification

 After implementation:

 1. Run ./install.sh https://github.com/user/test-repo.git
 2. Verify keys generated in keys/
 3. Add deploy key to test repo
 4. Verify repo access check passes
 5. Verify .env created with correct values
 6. Verify containers start and sandbox clones the repo
 7. Verify WebSocket rejects connections without token
 8. Verify WebSocket accepts connections with valid token
 9. Check docker logs detach-bridge shows QR code