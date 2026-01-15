#!/bin/bash
set -e

# Remote Deployment Script for detach.it
# Deploys to VPS from local machine via SSH

REMOTE_HOST="77.42.17.162"
REMOTE_USER="sal"
DEPLOY_DIR="/home/sal/detach.it"
COMPOSE_FILE="docker-compose.prod.yml"
SSH_OPTS="-o ConnectTimeout=10 -o BatchMode=yes"

echo "==================================="
echo "Detach.it Remote Deployment"
echo "Target: $REMOTE_USER@$REMOTE_HOST"
echo "==================================="
echo ""

# Execute command on remote server
ssh_exec() {
    local cmd="$1"
    local description="$2"

    echo "→ $description..."
    if ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "$cmd"; then
        echo "✓ $description complete"
        return 0
    else
        echo "✗ ERROR: $description failed"
        return 1
    fi
}

# Test SSH connection before attempting deployment
check_ssh_connectivity() {
    echo "Checking SSH connectivity to $REMOTE_HOST..."
    if ! ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "echo 'Connected'" &>/dev/null; then
        echo "ERROR: Cannot connect to $REMOTE_HOST"
        echo "Please ensure:"
        echo "  1. VPS is running"
        echo "  2. SSH key is configured for user 'sal'"
        echo "  3. Server is reachable at 77.42.17.162"
        exit 1
    fi
    echo "✓ SSH connection verified"
}

# Setup git repository if it doesn't exist
setup_git_repo() {
    echo ""
    echo "Setting up git repository..."

    # Check if GitHub deploy key is configured
    if ! ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "test -f ~/.ssh/github_deploy_key" &>/dev/null; then
        echo ""
        echo "ERROR: GitHub deploy key not found on remote server"
        echo ""
        echo "To set up GitHub access:"
        echo "  1. SSH into the server: ssh $REMOTE_USER@$REMOTE_HOST"
        echo "  2. Generate deploy key: ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key -C 'detach-deploy' -N ''"
        echo "  3. Display public key: cat ~/.ssh/github_deploy_key.pub"
        echo "  4. Add to GitHub: https://github.com/salvozappa/detach.it/settings/keys"
        echo "  5. Create SSH config:"
        echo "     cat > ~/.ssh/config <<EOF"
        echo "     Host github.com"
        echo "         HostName github.com"
        echo "         User git"
        echo "         IdentityFile ~/.ssh/github_deploy_key"
        echo "         IdentitiesOnly yes"
        echo "     EOF"
        echo "  6. Run this script again"
        echo ""
        exit 1
    fi

    # Clone the repository
    if ! ssh_exec "cd $DEPLOY_DIR && git clone git@github.com:salvozappa/detach.it.git ." "Cloning repository"; then
        echo "ERROR: Failed to clone repository. Check GitHub deploy key permissions."
        exit 1
    fi

    # Generate SSH keys for sandbox if they don't exist
    if ! ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "test -f $DEPLOY_DIR/keys/dev" &>/dev/null; then
        if ! ssh_exec "cd $DEPLOY_DIR && ssh-keygen -t ed25519 -f keys/dev -N '' -C 'detach-dev-key'" "Generating sandbox SSH keys"; then
            echo "ERROR: Failed to generate SSH keys for sandbox"
            exit 1
        fi
    fi

    echo "✓ Git repository set up"
}

# Verify remote environment is ready
check_remote_prerequisites() {
    echo ""
    echo "Verifying remote environment..."

    # Check deploy directory exists
    if ! ssh_exec "test -d $DEPLOY_DIR" "Checking deploy directory" &>/dev/null; then
        echo "ERROR: Deploy directory $DEPLOY_DIR not found"
        echo "This should have been created by cloud-init during VPS provisioning."
        exit 1
    fi

    # Check if it's a git repository - if not, set it up
    if ! ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && git rev-parse --git-dir" &>/dev/null; then
        echo "⚠ Git repository not found - this appears to be a first-time setup"
        setup_git_repo
    else
        echo "✓ Git repository found"
    fi

    # Check Docker access
    if ! ssh_exec "docker ps" "Verifying Docker access" &>/dev/null; then
        echo "ERROR: Docker not accessible on remote server"
        echo "This should have been configured by cloud-init."
        echo "You may need to re-login or run: ssh $REMOTE_USER@$REMOTE_HOST 'newgrp docker'"
        exit 1
    fi

    echo "✓ Remote environment ready"
}

# Main deployment function
deploy() {
    echo ""
    echo "==================================="
    echo "Starting Deployment"
    echo "==================================="
    echo ""

    # Show current commit before update
    echo "Current deployment:"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && git log -1 --oneline && echo '' && git status -s"
    echo ""

    # Git pull
    if ! ssh_exec "cd $DEPLOY_DIR && git pull" "Pulling latest changes"; then
        echo "ERROR: Git pull failed. Check remote git configuration."
        exit 1
    fi

    # Show what changed
    echo ""
    echo "Updated to:"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && git log -1 --oneline"
    echo ""

    # Build containers
    if ! ssh_exec "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE build" "Building Docker containers"; then
        echo "ERROR: Docker build failed"
        exit 1
    fi

    # Stop old containers first (avoids docker-compose 1.29.2 ContainerConfig bug)
    echo "→ Stopping old containers..."
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE down" || true
    echo "✓ Old containers stopped"

    # Start services with new images
    if ! ssh_exec "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE up -d" "Starting services"; then
        echo "ERROR: Failed to start services"
        exit 1
    fi

    # Wait for services to stabilize
    echo ""
    echo "Waiting for services to start..."
    sleep 5

    # Check status
    echo ""
    echo "Service Status:"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE ps"

    echo ""
    echo "==================================="
    echo "Deployment Complete!"
    echo "==================================="
}

# Display recent logs from services
show_logs() {
    echo ""
    echo "Recent logs (last 20 lines per service):"
    echo "-----------------------------------"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE logs --tail=20"
}

# Get and display access URLs
get_access_urls() {
    echo ""
    echo "Access URLs:"

    # Try to get Tailscale info
    TAILSCALE_HOSTNAME=$(ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "tailscale status --json 2>/dev/null | grep -o '\"DNSName\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4 | sed 's/\.$//'")
    TAILSCALE_IP=$(ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "tailscale ip -4 2>/dev/null")

    if [ -n "$TAILSCALE_HOSTNAME" ]; then
        echo "  HTTPS: https://$TAILSCALE_HOSTNAME"
    fi

    if [ -n "$TAILSCALE_IP" ]; then
        echo "  HTTP:  http://$TAILSCALE_IP:8080"
    fi

    echo ""
    echo "Useful commands:"
    echo "  ssh $REMOTE_USER@$REMOTE_HOST"
    echo "  ssh $REMOTE_USER@$REMOTE_HOST 'cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE logs -f'"
    echo "  ssh $REMOTE_USER@$REMOTE_HOST 'cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE restart'"
    echo ""
}

# Main execution
check_ssh_connectivity
check_remote_prerequisites
deploy
show_logs
get_access_urls

echo "Deployment finished at $(date)"
