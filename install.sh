#!/bin/bash
set -e

# Installation Script for detach.it
# Interactively sets up a detach.it instance for any git repository

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_DIR="$SCRIPT_DIR/keys"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
info() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# Prompt for input with optional default
prompt() {
    local message="$1"
    local default="$2"
    local result

    if [ -n "$default" ]; then
        read -rp "$message [$default]: " result
        echo "${result:-$default}"
    else
        read -rp "$message: " result
        echo "$result"
    fi
}

# Prompt for yes/no with default
prompt_yn() {
    local message="$1"
    local default="$2"
    local result

    if [ "$default" = "y" ]; then
        read -rp "$message [Y/n]: " result
        result="${result:-y}"
    else
        read -rp "$message [y/N]: " result
        result="${result:-n}"
    fi

    [[ "$result" =~ ^[Yy] ]]
}

# Convert HTTPS URL to SSH URL
convert_https_to_ssh() {
    local url="$1"
    # https://github.com/user/repo.git -> git@github.com:user/repo.git
    # https://gitlab.com/user/repo.git -> git@gitlab.com:user/repo.git
    echo "$url" | sed -E 's|https://([^/]+)/(.+)|git@\1:\2|'
}

# Extract repository name from URL
extract_repo_name() {
    local url="$1"
    # git@github.com:user/repo.git -> repo
    # https://github.com/user/repo.git -> repo
    basename "$url" .git
}

# Extract host from SSH URL
extract_host_from_ssh() {
    local url="$1"
    # git@github.com:user/repo.git -> github.com
    echo "$url" | sed -E 's|git@([^:]+):.*|\1|'
}

# Generate SSH key pair
generate_ssh_key() {
    local key_path="$1"
    local comment="$2"

    if [ -f "$key_path" ]; then
        warn "Key already exists: $key_path"
        return 0
    fi

    info "Generating SSH key: $key_path"
    ssh-keygen -t ed25519 -f "$key_path" -N "" -C "$comment" >/dev/null 2>&1
    chmod 600 "$key_path"
    chmod 644 "$key_path.pub"
    success "Generated: $key_path"
}

# Generate secure random token
generate_token() {
    openssl rand -base64 32 | tr -d '/+=' | head -c 43
}

# Verify repository access with deploy key
verify_repo_access() {
    local repo_url="$1"
    local key_path="$2"

    info "Verifying repository access..."
    if GIT_SSH_COMMAND="ssh -i $key_path -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
        git ls-remote "$repo_url" HEAD >/dev/null 2>&1; then
        success "Repository access verified"
        return 0
    else
        error "Cannot access repository"
        return 1
    fi
}

# Display QR code if qrencode is available
show_qr() {
    local url="$1"

    if command -v qrencode >/dev/null 2>&1; then
        echo ""
        qrencode -t ANSIUTF8 "$url"
    else
        warn "Install 'qrencode' to display QR codes in terminal"
    fi
}

# Check prerequisites
check_prerequisites() {
    local missing=()

    info "Checking dependencies..."

    if ! command -v docker >/dev/null 2>&1; then
        missing+=("docker")
    fi

    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        missing+=("docker-compose")
    fi

    if ! command -v ssh-keygen >/dev/null 2>&1; then
        missing+=("openssh-client")
    fi

    if ! command -v openssl >/dev/null 2>&1; then
        missing+=("openssl")
    fi

    if ! command -v git >/dev/null 2>&1; then
        missing+=("git")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Install them with:"
        echo "  Ubuntu/Debian: sudo apt install -y ${missing[*]}"
        echo "  macOS:         brew install ${missing[*]}"
        echo ""
        exit 1
    fi

    # Check Docker is running
    if ! docker info >/dev/null 2>&1; then
        error "Docker is not running."
        echo ""
        echo "Start Docker with:"
        echo "  sudo systemctl start docker"
        echo ""
        exit 1
    fi

    success "All dependencies available"
}

# Main installation flow
main() {
    echo ""
    echo "==========================================="
    echo "       detach.it Installation"
    echo "==========================================="
    echo ""

    # Check prerequisites
    check_prerequisites
    echo ""

    # 1. Get repository URL
    echo "Step 1: Repository Configuration"
    echo "---------------------------------"
    local repo_url
    repo_url=$(prompt "Git repository URL (SSH or HTTPS)")

    if [ -z "$repo_url" ]; then
        error "Repository URL is required"
        exit 1
    fi

    # Convert HTTPS to SSH if needed
    if [[ "$repo_url" == https://* ]]; then
        local ssh_url
        ssh_url=$(convert_https_to_ssh "$repo_url")
        info "Converting to SSH URL: $ssh_url"
        repo_url="$ssh_url"
    fi

    local repo_name
    repo_name=$(extract_repo_name "$repo_url")
    local working_dir="~/projects/$repo_name"
    echo ""

    # 2. Get git user configuration (optional)
    echo "Step 2: Git User Configuration (optional)"
    echo "------------------------------------------"
    local git_name
    local git_email
    git_name=$(prompt "Git user name (for commits, leave empty to skip)" "")
    git_email=$(prompt "Git email (for commits, leave empty to skip)" "")
    echo ""

    # 3. Claude permissions
    echo "Step 3: Claude Configuration"
    echo "----------------------------"
    local claude_args='["--dangerously-skip-permissions"]'
    if prompt_yn "Skip Claude permission prompts? (recommended for automation)" "y"; then
        claude_args='["--dangerously-skip-permissions"]'
        info "Claude will run with --dangerously-skip-permissions"
    else
        claude_args='[]'
        info "Claude will prompt for permissions"
    fi
    echo ""

    # 4. Generate SSH keys
    echo "Step 4: SSH Key Generation"
    echo "--------------------------"
    mkdir -p "$KEYS_DIR"

    generate_ssh_key "$KEYS_DIR/bridge" "detach-bridge"
    generate_ssh_key "$KEYS_DIR/deploy_key" "detach-deploy-key"
    echo ""

    # 5. Display deploy key and wait for user
    echo "Step 5: Deploy Key Setup"
    echo "------------------------"
    echo ""
    echo "Add this deploy key to your repository:"
    echo ""
    echo -e "${YELLOW}$(cat "$KEYS_DIR/deploy_key.pub")${NC}"
    echo ""

    local git_host
    git_host=$(extract_host_from_ssh "$repo_url")
    case "$git_host" in
        github.com)
            echo "GitHub: Go to your repo → Settings → Deploy keys → Add deploy key"
            echo "        Enable 'Allow write access' if you need to push"
            ;;
        gitlab.com)
            echo "GitLab: Go to your repo → Settings → Repository → Deploy keys"
            ;;
        *)
            echo "Add this public key as a deploy key in your git hosting provider"
            ;;
    esac
    echo ""

    read -rp "Press Enter once you've added the deploy key..."
    echo ""

    # 6. Verify repository access
    if ! verify_repo_access "$repo_url" "$KEYS_DIR/deploy_key"; then
        error "Could not access repository. Please check:"
        echo "  1. The deploy key was added correctly"
        echo "  2. The repository URL is correct"
        echo "  3. You have network access to $git_host"
        exit 1
    fi
    echo ""

    # 7. Generate auth token
    echo "Step 6: Authentication Setup"
    echo "----------------------------"
    local auth_token
    auth_token=$(generate_token)
    success "Generated authentication token"
    echo ""

    # 8. Create detach.json
    info "Creating detach.json..."
    cat > "$SCRIPT_DIR/detach.json" <<EOF
{
  "repo_url": "$repo_url",
  "git_name": "$git_name",
  "git_email": "$git_email",
  "claude_args": $claude_args,
  "working_dir": "$working_dir"
}
EOF
    success "Created detach.json"

    # 9. Create .env file
    info "Creating .env..."
    cat > "$SCRIPT_DIR/.env" <<EOF
DETACH_TOKEN=$auth_token
WEBVIEW_HOST=localhost:8080
EOF
    success "Created .env"
    echo ""

    # 10. Build and start containers
    echo "Step 7: Starting Services"
    echo "-------------------------"
    info "Building containers (this may take a few minutes)..."

    cd "$SCRIPT_DIR"
    if docker compose version >/dev/null 2>&1; then
        docker compose build
        docker compose up -d
    else
        docker-compose build
        docker-compose up -d
    fi

    success "Services started"
    echo ""

    # 11. Display pairing information
    echo "==========================================="
    echo "       Installation Complete!"
    echo "==========================================="
    echo ""
    echo "Pair your device by opening this URL:"
    echo ""
    local pairing_url="http://localhost:8080?token=$auth_token"
    echo -e "${GREEN}$pairing_url${NC}"
    show_qr "$pairing_url"
    echo ""
    echo "Or view the QR code in bridge logs:"
    echo "  docker logs detach-bridge"
    echo ""
    echo "Your repository ($repo_name) will be cloned on first connection."
    echo ""
}

# Run main function
main "$@"
