# VPS Infrastructure Setup

This directory contains configuration and deployment scripts for running detach.it on a VPS for nightly testing.

## Files

- **vps-config-init.yaml** - Cloud-init configuration for VPS provisioning
- **deploy-to-vps.sh** - Automated deployment script

## Quick Start (New VPS)

For provisioning a brand new VPS:

1. **Provision VPS** with `vps-config-init.yaml` as cloud-init
2. **Wait 2-3 minutes** for cloud-init to complete
3. **Connect and configure Tailscale**: `ssh sal@<vps-ip>` → `sudo tailscale up`
4. **Setup GitHub deploy key** (one-time, see below)
5. **Run deploy script** from your local machine: `./infrastructure/deploy-to-vps.sh`
6. **Done!** Access via Tailscale HTTPS URL

See detailed steps below for first-time setup.

---

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

**For a new VPS:** First, update the server hostname in the deploy script:

```bash
# Edit infrastructure/deploy-to-vps.sh
# Change REMOTE_HOST to your new VPS Tailscale hostname (e.g., "hostname.tail5fb253.ts.net")
```

Then run the deploy script from your local machine:

```bash
# From your local machine in the project directory
./infrastructure/deploy-to-vps.sh
```

The script will:
- Connect to the VPS via SSH
- Detect if this is a first-time deployment
- Clone the repository (first time only)
- Generate SSH keys for sandbox (first time only)
- Pull latest changes from git
- Build Docker containers
- Restart services
- Display logs and access URLs

**First-time deployment:** The script will automatically detect if the git repo isn't set up yet and guide you through configuring the GitHub deploy key if needed.

### 5. Access from Phone/Device

1. Install Tailscale app on your device
2. Sign in with same account
3. Open browser to:
   - **HTTPS (recommended)**: `https://<vps-hostname>.tail-scale.ts.net`
   - HTTP (fallback): `http://<vps-tailscale-ip>:8080`

## Manual Commands (Advanced)

If you need to run commands directly on the VPS:

```bash
# SSH into VPS
ssh sal@<vps-ip-or-hostname>

# Navigate to project
cd ~/detach.it

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart a specific service
docker-compose -f docker-compose.prod.yml restart bridge

# Check status
docker-compose -f docker-compose.prod.yml ps

# Rebuild manually (not recommended - use deploy script instead)
git pull
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## Updating the Application

Simply run the deploy script again from your local machine:

```bash
./infrastructure/deploy-to-vps.sh
```

The script will automatically:
- Pull the latest changes from git
- Rebuild Docker containers if needed
- Restart services with zero downtime
- Show you what changed

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

### Network Isolation

The VPS is configured to **only accept connections via Tailscale VPN**:

**Port Binding:**
- All application ports (8080, 8081, 2222) are bound to `127.0.0.1` (localhost only)
- Services are **not accessible** from the public IP address
- Tailscale serve proxies `localhost:8080` to provide HTTPS access via the VPN

**Firewall (UFW):**
- SSH (port 22): Allowed from anywhere (for initial setup and management)
- Tailscale interface: All traffic allowed (VPN access)
- All other incoming traffic: **Denied by default**

**Testing Security:**
```bash
# From public internet - these should fail:
curl http://<public-vps-ip>:8080  # Connection refused
curl http://<public-vps-ip>:8081  # Connection refused

# From Tailscale network - works:
curl https://<hostname>.tail-scale.ts.net  # Success!
```

### Additional Security Measures

- **SSH Hardening**: No root login, no password authentication (key-based only)
- **fail2ban**: Automatic blocking of brute force SSH attempts
- **Automatic Updates**: Security patches applied automatically
- **Container Isolation**: Services run in isolated Docker containers
- **Read-only SSH Keys**: Sandbox SSH keys mounted read-only

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
