FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=it_IT.UTF-8 \
    LC_ALL=it_IT.UTF-8 \
    TZ=Europe/Rome \
    DISPLAY=:1

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc novnc python3-websockify supervisor dbus-x11 \
      xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-terminal xfce4-settings thunar mousepad \
      chromium fonts-noto fonts-noto-cjk fonts-noto-color-emoji fonts-dejavu \
      xdotool imagemagick xclip autocutsel \
      curl wget git jq python3 python3-pip python3-venv ca-certificates sudo locales tzdata procps less nano unzip \
    && sed -i 's/# it_IT.UTF-8/it_IT.UTF-8/; s/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
    && rm -rf /var/lib/apt/lists/*

RUN usermod -l agent -d /home/agent -m node && groupmod -n agent node \
    && echo 'agent ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/agent && chmod 440 /etc/sudoers.d/agent \
    && echo 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --disable-dev-shm-usage --no-first-run --password-store=basic --test-type"' > /etc/chromium.d/cora \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && mv /usr/share/novnc/vendor /usr/share/novnc/thirdparty \
    && sed -i 's#\.\./vendor/pako/#../thirdparty/pako/#g' /usr/share/novnc/core/inflator.js /usr/share/novnc/core/deflator.js \
    && ! grep -rq "vendor/pako" /usr/share/novnc/core \
    && printf '{"name":"novnc","version":"%s"}\n' "$(dpkg-query -W -f='${Version}' novnc | cut -d: -f2 | cut -d- -f1)" > /usr/share/novnc/package.json

# Remote access: Tailscale (its own node per agent, Tailscale SSH) and an OpenSSH
# server reached through the host. Their state lives in the /var/lib/cora volume.
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list \
    && apt-get update && apt-get install -y --no-install-recommends tailscale openssh-server \
    && rm -rf /var/lib/apt/lists/* /var/lib/tailscale /etc/ssh/ssh_host_* \
    && ln -s /var/lib/cora/tailscale /var/lib/tailscale
COPY sshd.conf /etc/ssh/sshd_config.d/cora.conf

# Tools every agent gets: hush, so it can use a secret by name without ever seeing it,
# and ambox, its own end-to-end encrypted mailbox. Pinned, and the install is checked.
ARG HUSH_VERSION=v0.7.1
ARG AMBOX_VERSION=1.2.0
RUN curl -fsSL https://raw.githubusercontent.com/turinglabsorg/hush/${HUSH_VERSION}/install.sh \
      | sh -s -- --version ${HUSH_VERSION} --install-dir /usr/local/bin \
    && npm install -g ambox@${AMBOX_VERSION} \
    && npm cache clean --force \
    && hush --version && ambox --version

COPY supervisord.conf /etc/supervisor/cora.conf
COPY start.sh /usr/local/bin/cora-box-start
RUN chmod 755 /usr/local/bin/cora-box-start

EXPOSE 6080
CMD ["/usr/local/bin/cora-box-start"]
