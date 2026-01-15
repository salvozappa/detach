# VPS Infrastructure Setup

This directory contains configuration and deployment scripts for running detach.it on a VPS for nightly testing.

## Files

- **vps-config-init.yaml** - Cloud-init configuration for VPS provisioning
- **deploy-to-vps.sh** - Automated deployment script

## Deployment Process

### 1. Provision VPS

Use `vps-config-init.yaml` as your cloud-init user data when creating a VPS instance.

**What it sets up:**
- Two users: `sal` and `detach-dev` with SSH key authentication
- Docker and Docker Compose
- Tailscale (installed but not configured)
- Firewall (UFW) allowing SSH and Tailscale
- Security: fail2ban, auto-updates, hardened SSH
- Development directories

**Supported providers:**
- DigitalOcean (use as User Data)
- Hetzner Cloud (use as Cloud-init)
- AWS EC2 (use as User Data)
- Most Ubuntu-based cloud providers

### 2. Connect to VPS via Tailscale

After VPS boots up (wait ~2-3 minutes):

```bash
# SSH into VPS
ssh sal@<vps-public-ip>

# Start Tailscale
sudo tailscale up

# Note the Tailscale IP (usually 100.x.x.x)
tailscale ip -4
```

### 2.5. Setup GitHub Deploy Key

Generate and configure GitHub deploy key for read-only repository access:

```bash
# On VPS
ssh sal@<vps-public-ip>

# Generate deploy key
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key -C "detach-nightly-deploy" -N ""

# Display public key to add to GitHub
cat ~/.ssh/github_deploy_key.pub
```

**Add to GitHub:**
1. Go to repository → Settings → Deploy keys
2. Click "Add deploy key"
3. Title: "VPS Nightly Server"
4. Paste public key
5. Don't check "Allow write access"
6. Click "Add key"

**Configure SSH:**
```bash
# Create SSH config
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_deploy_key
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config ~/.ssh/github_deploy_key

# Test
ssh -T git@github.com
```

### 3. Enable HTTPS in Tailscale (Optional but Recommended for PWA)

For Progressive Web App features, enable HTTPS before deploying:

1. Go to https://login.tailscale.com/admin/dns
2. Enable "HTTPS Certificates" in DNS settings

This allows the deployment script to automatically configure HTTPS.

### 4. Deploy Application

From your local machine, copy the deployment script to VPS:

```bash
scp infrastructure/deploy-to-vps.sh sal@<vps-public-ip>:~/
```

Then SSH into the VPS and run it:

```bash
ssh sal@<vps-public-ip>
./deploy-to-vps.sh
```

The script will:
- Prompt for repository URL
- Clone the repo
- Generate SSH keys if needed
- Fix SSH key permissions for container compatibility
- Build Docker containers
- Start services
- **Automatically configure Tailscale HTTPS** (if enabled in admin)
- Display access URLs

### 5. Access from Phone/Device

1. Install Tailscale app on your device
2. Sign in with same account
3. Open browser to:
   - **HTTPS (recommended)**: `https://<vps-hostname>.tail-scale.ts.net`
   - HTTP (fallback): `http://<vps-tailscale-ip>:8080`

## Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
# On VPS
cd ~
git clone <repo-url> detach.it
cd detach.it

# Ensure SSH keys exist
ls keys/dev keys/dev.pub
# If not, generate them:
# ssh-keygen -t ed25519 -f keys/dev -N ""

# Deploy
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

## Updating the Application

```bash
cd ~/detach.it
git pull
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Check Docker is running
```bash
sudo systemctl status docker
docker ps
```

### Check Tailscale status
```bash
tailscale status
tailscale ip
```

### View application logs
```bash
cd ~/detach.it
docker-compose -f docker-compose.prod.yml logs -f
```

### Restart services
```bash
cd ~/detach.it
docker-compose -f docker-compose.prod.yml restart
```

### Check firewall
```bash
sudo ufw status
```

### User not in docker group
If you get permission denied with docker:
```bash
sudo usermod -aG docker $USER
newgrp docker
# Or log out and back in
```

### SSH authentication failures in bridge logs
If you see `ssh: handshake failed: ssh: unable to authenticate` in bridge logs:

```bash
# Check if keys have correct permissions and ownership
cd ~/detach.it
ls -la keys/

# The dev.pub file must be owned by UID 1001 (container's detach-dev user)
# and have 600 permissions
sudo chown 1001:1001 keys/dev.pub
chmod 600 keys/dev keys/dev.pub

# Restart containers
docker-compose -f docker-compose.prod.yml restart sandbox bridge
```

**Note**: The deployment script automatically sets correct permissions, but if you manually copy keys or restore from backup, you may need to fix ownership.

## Security Notes

- VPS is **NOT** exposed to public internet (except SSH)
- All application ports (8080, 8081, 2222) are only accessible via Tailscale
- Firewall blocks all incoming traffic except SSH and Tailscale
- SSH is hardened: no root login, no password authentication
- fail2ban protects against brute force attacks
- Automatic security updates enabled

## Cost Considerations

**VPS Requirements (minimum):**
- 2 CPU cores
- 4GB RAM
- 20GB SSD
- ~$12-24/month (DigitalOcean, Hetzner, etc.)

**Tailscale:**
- Free tier: 3 users, 100 devices, unlimited networks

## Architecture

```
[Your Phone/Device]
        |
   (Tailscale VPN)
        |
    [VPS: 100.x.x.x]
        |
    [Docker Compose]
        ├── webview (nginx) :8080
        ├── bridge (websocket) :8081
        └── sandbox (ssh) :2222
```
