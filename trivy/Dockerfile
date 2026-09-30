# curl is needed to enumerate images over the Docker API; the upstream image ships
# without it and cannot apk add at runtime as uid 1001. See trivy/README.md.
FROM aquasec/trivy:latest

USER root
RUN apk add --no-cache curl

RUN addgroup -g 1001 -S scanner 2>/dev/null || true
RUN adduser -u 1001 -S -G scanner -h /tmp scanner 2>/dev/null || true

ENV HOME=/tmp \
    TRIVY_CACHE_DIR=/var/cache/trivy

RUN mkdir -p /var/cache/trivy /reports && \
    chown -R 1001:1001 /var/cache/trivy /reports && \
    chmod 700 /var/cache/trivy && \
    chmod 755 /reports

USER 1001:1001

ENTRYPOINT ["trivy"]
