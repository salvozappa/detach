FROM ubuntu:24.04

# Set environment to non-interactive to avoid prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Update and install essential development packages
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    wget \
    vim \
    htop \
    tmux \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    nodejs \
    npm \
    openssh-server \
    sudo \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create detach-dev user with sudo privileges
RUN useradd -m -s /bin/bash -G sudo,users detach-dev && \
    echo "detach-dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Configure SSH server
# - Disable root login
# - Disable password authentication (key-based only)
# - Enable public key authentication
RUN mkdir /var/run/sshd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Set up SSH directory for detach-dev user
RUN mkdir -p /home/detach-dev/.ssh && \
    chmod 700 /home/detach-dev/.ssh && \
    chown -R detach-dev:detach-dev /home/detach-dev/.ssh

# Create projects directory for development work
RUN mkdir -p /home/detach-dev/projects/sample && \
    chown -R detach-dev:detach-dev /home/detach-dev && \
    chmod -R 755 /home/detach-dev/projects

# Install Claude CLI as detach-dev user
USER detach-dev
WORKDIR /home/detach-dev
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/detach-dev/.bashrc

# Initialize git repository in sample project
WORKDIR /home/detach-dev/projects/sample
RUN git init && \
    git config user.email "dev@detach.it" && \
    git config user.name "Detach Dev" && \
    echo "# Sample Project" > README.md && \
    git add README.md && \
    git commit -m "Initial commit"

# Switch back to root for remaining setup
USER root

# Expose SSH port
EXPOSE 22

# Add entrypoint script that fixes key ownership before starting sshd
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Start via entrypoint (fixes key ownership, then starts sshd)
CMD ["/entrypoint.sh"]
