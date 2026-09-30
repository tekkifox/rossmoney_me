# The config is baked in rather than mounted via Compose `configs`, which
# materialises as a root-owned file the non-root master cannot read. See
# ../docker-compose.monitoring.yml.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN chmod 644 /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/cache/nginx /var/run && \
    chown -R 1001:1001 /var/cache/nginx /var/run
