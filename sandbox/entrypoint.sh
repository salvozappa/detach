#!/bin/bash
set -e

# Setup .ssh directory
mkdir -p /home/detach-dev/.ssh
chown detach-dev:detach-dev /home/detach-dev/.ssh
chmod 700 /home/detach-dev/.ssh

# Copy authorized_keys from mounted location
if [ -f /tmp/authorized_keys ]; then
    cp /tmp/authorized_keys /home/detach-dev/.ssh/authorized_keys
    chown detach-dev:detach-dev /home/detach-dev/.ssh/authorized_keys
    chmod 600 /home/detach-dev/.ssh/authorized_keys
fi

# Copy SSH keys from volume mount to a location with correct ownership
# (volume-mounted files are read-only and owned by root)
if [ -f /home/detach-dev/.ssh/id_ed25519 ]; then
    cp /home/detach-dev/.ssh/id_ed25519 /tmp/id_ed25519_tmp
    cp /home/detach-dev/.ssh/id_ed25519.pub /tmp/id_ed25519_tmp.pub 2>/dev/null || true
    chown detach-dev:detach-dev /tmp/id_ed25519_tmp /tmp/id_ed25519_tmp.pub 2>/dev/null || true
    chmod 600 /tmp/id_ed25519_tmp

    # Create SSH config to use the writable key for GitHub
    cat > /home/detach-dev/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile /tmp/id_ed25519_tmp
    IdentitiesOnly yes
EOF
    chown detach-dev:detach-dev /home/detach-dev/.ssh/config
    chmod 600 /home/detach-dev/.ssh/config
fi

# Add GitHub to known_hosts if not present
if ! grep -q "github.com" /home/detach-dev/.ssh/known_hosts 2>/dev/null; then
    echo "Adding github.com to known_hosts..."
    ssh-keyscan github.com >> /home/detach-dev/.ssh/known_hosts 2>/dev/null
fi
chown detach-dev:detach-dev /home/detach-dev/.ssh/known_hosts 2>/dev/null || true
chmod 644 /home/detach-dev/.ssh/known_hosts 2>/dev/null || true

# Configuration file path (mounted as read-only volume)
CONFIG_FILE="/etc/detach/detach.json"

# Read configuration values from detach.json
if [ -f "$CONFIG_FILE" ]; then
    REPO_URL=$(jq -r '.repo_url // empty' "$CONFIG_FILE")
    GIT_NAME=$(jq -r '.git_name // empty' "$CONFIG_FILE")
    GIT_EMAIL=$(jq -r '.git_email // empty' "$CONFIG_FILE")
else
    echo "WARNING: $CONFIG_FILE not found, using defaults"
    REPO_URL=""
    GIT_NAME=""
    GIT_EMAIL=""
fi

# Configure git user (only if specified in config)
if [ -n "$GIT_EMAIL" ]; then
    sudo -u detach-dev git config --global user.email "$GIT_EMAIL"
fi
if [ -n "$GIT_NAME" ]; then
    sudo -u detach-dev git config --global user.name "$GIT_NAME"
fi

# Hardcoded project directory (single-repo app)
PROJECT_DIR="/home/detach-dev/project"

# Clone project repo if it doesn't exist
if [ -n "$REPO_URL" ] && [ ! -d "$PROJECT_DIR" ]; then
    echo "Cloning repository $REPO_URL to $PROJECT_DIR..."
    mkdir -p "$(dirname "$PROJECT_DIR")"
    chown detach-dev:detach-dev "$(dirname "$PROJECT_DIR")"

    # Use GIT_SSH_COMMAND to specify the key with correct permissions
    sudo -u detach-dev GIT_SSH_COMMAND="ssh -i /tmp/id_ed25519_tmp -o StrictHostKeyChecking=accept-new" \
        git clone "$REPO_URL" "$PROJECT_DIR"
fi

# Ensure Claude Code hooks configuration exists in project
# TODO: Merge existing settings with template instead of overwriting, to preserve
# any user customizations while ensuring required hooks are present
CLAUDE_SETTINGS="$PROJECT_DIR/.claude/settings.json"
echo "Updating Claude Code hooks configuration..."
mkdir -p "$PROJECT_DIR/.claude"
cp /tmp/claude-settings-template.json "$CLAUDE_SETTINGS"
chown -R detach-dev:detach-dev "$PROJECT_DIR/.claude"

# Add .claude/ to local git exclude (doesn't affect remote .gitignore)
if ! grep -q "^\.claude/$" "$PROJECT_DIR/.git/info/exclude" 2>/dev/null; then
    echo ".claude/" >> "$PROJECT_DIR/.git/info/exclude"
fi

# Start sshd
exec /usr/sbin/sshd -D
