# VPS Infrastructure Setup

This directory contains configuration and deployment scripts for running detach.it on a VPS for nightly testing.

## Files

- **vps-config-init.yaml** - Cloud-init configuration for VPS provisioning
- **../deploy.sh** - Automated deployment script (in repository root)

## Quick Start (New VPS)

For provisioning a brand new VPS:

1. **Provision VPS** with `vps-config-init.yaml` as cloud-init
2. **Wait 2-3 minutes** for cloud-init to complete
3. **Setup GitHub deploy key** (one-time, see below)
4. **Run deploy script** from your local machine: `./deploy.sh`
5. **Done!** Access via VPS IP

See detailed steps below for first-time setup.

---

## Deployment Process

### 1. Provision VPS

Use `vps-config-init.yaml` as your cloud-init user data when creating a VPS instance.

**What it sets up:**
- Two users: `sal` and `detach-dev` with SSH key authentication
- Docker and Docker Compose
- Firewall (UFW) allowing SSH
- Security: fail2ban, auto-updates, hardened SSH
- Development directories

**Supported providers:**
- DigitalOcean (use as User Data)
- Hetzner Cloud (use as Cloud-init)
- AWS EC2 (use as User Data)
- Most Ubuntu-based cloud providers

### 2. Connect to VPS

After VPS boots up (wait ~2-3 minutes):

```bash
# SSH into VPS
ssh sal@<vps-public-ip>
```

### 2.5. Setup GitHub Deploy Key (One-time)

The GitHub deploy key is stored in the repository at `keys/github_deploy_key`. The deploy script automatically syncs it to the VPS.

**Add the public key to GitHub (one-time):**
1. Copy contents of `keys/github_deploy_key.pub`
2. Go to: https://github.com/salvozappa/detach.it/settings/keys
3. Click "Add deploy key"
4. Title: "VPS Nightly Server"
5. Paste public key
6. Don't check "Allow write access" (read-only is sufficient)
7. Click "Add key"

The deploy script will automatically:
- Copy the key to `~/.ssh/github_deploy_key` on the VPS
- Configure SSH to use it for GitHub

### 3. Deploy Application

**For a new VPS:** First, update the server hostname in the deploy script:

```bash
# Edit deploy.sh in repository root
# Change REMOTE_HOST to your VPS IP or hostname
```

Then run the deploy script from your local machine:

```bash
# From your local machine in the project directory
./deploy.sh

# Or to deploy uncommitted local changes (for testing):
./deploy.sh --rsync
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

### 4. Access from Device

Open browser to: `http://<vps-ip>:8080`

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
# Deploy from git (recommended for production)
./deploy.sh

# Deploy local uncommitted changes (for testing)
./deploy.sh --rsync
```

The script will automatically:
- Pull the latest changes from git (or sync local files in rsync mode)
- Rebuild Docker containers
- Restart services
- Show you what changed

## Troubleshooting

### Check Docker is running
```bash
sudo systemctl status docker
docker ps
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
sudo chown 1001:1001 keys/bridge.pub
chmod 600 keys/bridge keys/bridge.pub

# Restart containers
docker-compose -f docker-compose.prod.yml restart sandbox bridge
```

**Note**: The deployment script automatically sets correct permissions, but if you manually copy keys or restore from backup, you may need to fix ownership.

## Security Notes

### Network Security

**Firewall (UFW):**
- SSH (port 22): Allowed from anywhere (for initial setup and management)
- All other incoming traffic: **Denied by default**

Consider restricting access to specific IPs or using a VPN for additional security.

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

## Architecture

```
[Your Device]
        |
   (HTTP/HTTPS)
        |
    [VPS]
        |
    [Docker Compose]
        ├── webview (nginx) :8080
        ├── bridge (websocket) :8081
        └── sandbox (ssh) :2222
```
