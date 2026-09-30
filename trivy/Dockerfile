FROM aquasec/trivy:latest

# The upstream image ships without curl (only ca-certificates and git), and the
# scan job needs it to enumerate images over the Docker socket. Installing it at
# runtime with `apk add` requires root, which the container no longer has, so it
# is baked in here instead.
USER root
RUN apk add --no-cache curl

# Non-root runtime user. uid/gid 1001 matches the other services in the stack.
RUN addgroup -g 1001 -S scanner 2>/dev/null || true
RUN adduser -u 1001 -S -G scanner -h /tmp scanner 2>/dev/null || true
ENV HOME=/tmp \
    TRIVY_CACHE_DIR=/var/cache/trivy

# Writable locations for the cache and reports, both backed by named volumes.
# Must run as root: mkdir/chown before the USER switch would be denied.
RUN mkdir -p /var/cache/trivy /reports && \
    chown -R 1001:1001 /var/cache/trivy /reports && \
    chmod 700 /var/cache/trivy && \
    chmod 755 /reports

USER 1001:1001

ENTRYPOINT ["trivy"]
