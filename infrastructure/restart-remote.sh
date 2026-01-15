#!/bin/bash
set -e

# Restart remote containers without rebuilding
# Use deploy-to-vps.sh for full deployments with code changes

REMOTE_HOST="77.42.17.162"
REMOTE_USER="sal"
DEPLOY_DIR="/home/sal/detach.it"
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
