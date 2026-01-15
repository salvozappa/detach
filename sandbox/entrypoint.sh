#!/bin/bash
# Copy authorized_keys from mounted location and fix ownership
if [ -f /tmp/authorized_keys ]; then
    cp /tmp/authorized_keys /home/detach-dev/.ssh/authorized_keys
    chown detach-dev:detach-dev /home/detach-dev/.ssh/authorized_keys
    chmod 600 /home/detach-dev/.ssh/authorized_keys
fi

# Start sshd
exec /usr/sbin/sshd -D
