# VPS Deployment Guide

## Automated Setup (Recommended)

For automated VPS provisioning and deployment, see:
- **infrastructure/README.md** - Complete VPS setup guide
- **infrastructure/vps-config-init.yaml** - Cloud-init configuration
- **infrastructure/deploy-to-vps.sh** - Automated deployment script

The infrastructure directory provides one-command deployment with Docker and security hardening pre-configured.

## Manual Deploy (Nightly Testing)

### Prerequisites
- VPS with Docker and Docker Compose installed

### 1. Deploy Application
```bash
# Clone repo
git clone <your-repo> detach.it
cd detach.it

# Ensure SSH keys exist
ls -la keys/bridge keys/bridge.pub

# Build and start services (production config)
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
docker logs detach-bridge
docker logs detach-webview
docker logs detach-sandbox
```

### 2. Access from Device
Open browser to `http://<vps-ip>:8080`

### 3. Updates
```bash
cd detach.it
git pull
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## Key Differences from Development

### No Bind Mounts
- `webview` files are baked into image during build
- Changes to HTML/CSS/JS require rebuild + restart
- Run `docker-compose -f docker-compose.prod.yml build webview` after frontend changes

### Resource Limits
- **Sandbox**: 2GB RAM max, 2 CPU cores
- **Bridge**: 256MB RAM max, 0.5 CPU cores
- **Webview**: 128MB RAM max, 0.25 CPU cores

Adjust in `docker-compose.prod.yml` if needed.

### Log Rotation
- Logs automatically rotate at 10MB
- Keeps last 3 files per container
- Prevents disk filling up

## Security

### Firewall Configuration (UFW)
```bash
# Block all incoming except SSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
```

## Troubleshooting

### Check Services
```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Logs
```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker logs -f detach-bridge
docker logs -f detach-webview
docker logs -f detach-sandbox
```

### Restart Services
```bash
# Restart all
docker-compose -f docker-compose.prod.yml restart

# Restart specific
docker-compose -f docker-compose.prod.yml restart bridge
```

### Clean Rebuild
```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

## Backup

### Sandbox Home Directory
The sandbox home directory persists in a Docker volume:
```bash
# Backup
docker run --rm -v detach_sandbox-home:/data -v $(pwd):/backup \
  alpine tar czf /backup/sandbox-home-backup.tar.gz -C /data .

# Restore
docker run --rm -v detach_sandbox-home:/data -v $(pwd):/backup \
  alpine tar xzf /backup/sandbox-home-backup.tar.gz -C /data
```

## Monitoring

### Resource Usage
```bash
docker stats
```

### Disk Usage
```bash
docker system df
```
