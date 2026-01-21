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
fi

# Add GitHub to known_hosts if not present
if ! grep -q "github.com" /home/detach-dev/.ssh/known_hosts 2>/dev/null; then
    echo "Adding github.com to known_hosts..."
    ssh-keyscan github.com >> /home/detach-dev/.ssh/known_hosts 2>/dev/null
fi
chown detach-dev:detach-dev /home/detach-dev/.ssh/known_hosts 2>/dev/null || true
chmod 644 /home/detach-dev/.ssh/known_hosts 2>/dev/null || true

# Clone project repo if it doesn't exist
PROJECT_DIR="/home/detach-dev/projects/notestash"
if [ ! -d "$PROJECT_DIR" ]; then
    echo "Cloning notestash repository..."
    mkdir -p /home/detach-dev/projects
    chown detach-dev:detach-dev /home/detach-dev/projects

    # Use GIT_SSH_COMMAND to specify the key with correct permissions
    sudo -u detach-dev GIT_SSH_COMMAND="ssh -i /tmp/id_ed25519_tmp -o StrictHostKeyChecking=accept-new" \
        git clone git@github.com:salvozappa/notestash.git "$PROJECT_DIR"
fi

# Start sshd
exec /usr/sbin/sshd -D
