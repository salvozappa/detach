#!/bin/bash
set -e

# Restart remote containers without rebuilding
# Use deploy-to-vps.sh for full deployments with code changes

REMOTE_HOST="${DETACH_REMOTE_HOST:?Set DETACH_REMOTE_HOST to your VPS IP or hostname}"
REMOTE_USER="${DETACH_REMOTE_USER:-$(whoami)}"
DEPLOY_DIR="${DETACH_DEPLOY_DIR:-/home/$REMOTE_USER/detach}"
COMPOSE_FILE="docker-compose.prod.yml"
SSH_OPTS="-o ConnectTimeout=10 -o BatchMode=yes"

echo "Restarting detach.it on $REMOTE_HOST..."

# Restart containers
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE restart"

# Wait for services to stabilize
sleep 3

# Show status
echo ""
echo "Service Status:"
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $DEPLOY_DIR && docker-compose -f $COMPOSE_FILE ps"

echo ""
echo "Done."
