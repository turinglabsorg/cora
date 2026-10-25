#!/bin/sh
set -e
mkdir -p /home/agent/Desktop /home/agent/work /var/log/supervisor /var/lib/cora/tailscale /var/lib/cora/ssh /run/sshd /run/tailscale
chmod 700 /var/lib/cora/ssh
[ -f /var/lib/cora/ssh/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N "" -f /var/lib/cora/ssh/ssh_host_ed25519_key
[ -f /etc/ssh/cora_authorized_keys ] || install -m 644 /dev/null /etc/ssh/cora_authorized_keys
if [ ! -f /home/agent/.profile ]; then
  cp -rn /etc/skel/. /home/agent/ 2>/dev/null || true
fi
chown -R agent:agent /home/agent
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
exec /usr/bin/supervisord -c /etc/supervisor/cora.conf
