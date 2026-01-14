#!/bin/bash
set -e

# Deployment script for detach.it on VPS
# Run this after VPS is provisioned with vps-config-init.yaml

echo "==================================="
echo "Detach.it VPS Deployment Script"
echo "==================================="
echo ""

# Check if we're root
if [ "$EUID" -eq 0 ]; then
  echo "ERROR: Don't run this script as root. Run as 'sal' user."
  exit 1
fi

# Check if docker is available
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker not found. Is the VPS properly initialized?"
  exit 1
fi

# Check if user is in docker group
if ! groups | grep -q docker; then
  echo "ERROR: User not in docker group. You may need to log out and back in."
  echo "Or run: sudo usermod -aG docker $USER && newgrp docker"
  exit 1
fi

# Check if Tailscale is installed
if ! command -v tailscale &> /dev/null; then
  echo "ERROR: Tailscale not installed. Run: curl -fsSL https://tailscale.com/install.sh | sh"
  exit 1
fi

# Check if Tailscale is up
if ! tailscale status &> /dev/null; then
  echo "WARNING: Tailscale is not running or not authenticated"
  echo "Run: sudo tailscale up"
  echo "Then run this script again."
  exit 1
fi

# Get Tailscale IP
TAILSCALE_IP=$(tailscale ip -4)
TAILSCALE_HOSTNAME=$(tailscale status --json | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//')
echo "Tailscale IP: $TAILSCALE_IP"
echo ""

# Check if GitHub deploy key is set up
if [ ! -f "$HOME/.ssh/github_deploy_key" ]; then
  echo "WARNING: GitHub deploy key not found at ~/.ssh/github_deploy_key"
  echo ""
  echo "To set up GitHub access for deployment:"
  echo "  1. Generate key: ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key -C 'detach-nightly-deploy' -N ''"
  echo "  2. Display public key: cat ~/.ssh/github_deploy_key.pub"
  echo "  3. Add to GitHub: Repo → Settings → Deploy keys → Add deploy key"
  echo "  4. Configure SSH: See infrastructure/README.md for details"
  echo ""
  read -p "Press Enter when GitHub deploy key is configured, or Ctrl+C to exit..."
fi
echo ""

# Set deployment directory
DEPLOY_DIR="$HOME/detach.it"

# Ask for confirmation if directory exists
if [ -d "$DEPLOY_DIR" ]; then
  echo "WARNING: $DEPLOY_DIR already exists."
  read -p "Do you want to pull latest changes? (y/n): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$DEPLOY_DIR"
    git pull
  fi
else
  # Clone repository
  echo "Cloning repository..."
  read -p "Enter git repository URL: " REPO_URL
  git clone "$REPO_URL" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

# Check if SSH keys exist
if [ ! -f "keys/dev" ] || [ ! -f "keys/dev.pub" ]; then
  echo "WARNING: SSH keys not found in keys/ directory"
  echo "Generating new SSH keys..."
  mkdir -p keys
  ssh-keygen -t ed25519 -f keys/dev -N "" -C "detach-dev-key"
fi

# Build and start containers
echo ""
echo "Building Docker containers..."
docker-compose -f docker-compose.prod.yml build

echo ""
echo "Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait a moment for services to start
sleep 3

# Check status
echo ""
echo "Checking service status..."
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "==================================="
echo "Deployment Complete!"
echo "==================================="
echo ""
echo "Access your app:"
echo "  HTTP (works now):  http://$TAILSCALE_IP:8080"
echo "  HTTPS (for PWA):   https://$TAILSCALE_HOSTNAME"
echo ""
echo "To enable HTTPS for Progressive Web App:"
echo "  1. Enable HTTPS in Tailscale admin console:"
echo "     https://login.tailscale.com/admin/dns"
echo "  2. Enable 'HTTPS Certificates' in DNS settings"
echo "  3. Run: sudo tailscale serve --bg --https 443 http://localhost:8080"
echo "  4. Access at: https://$TAILSCALE_HOSTNAME"
echo ""
echo "Useful commands:"
echo "  cd $DEPLOY_DIR"
echo "  docker-compose -f docker-compose.prod.yml ps       # Check status"
echo "  docker-compose -f docker-compose.prod.yml logs -f  # View logs"
echo "  docker-compose -f docker-compose.prod.yml restart  # Restart services"
echo ""
echo "To update and redeploy:"
echo "  cd $DEPLOY_DIR"
echo "  git pull"
echo "  docker-compose -f docker-compose.prod.yml build"
echo "  docker-compose -f docker-compose.prod.yml up -d"
echo ""
