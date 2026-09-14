FROM nginx:1.27-alpine

RUN mkdir -p /usr/share/nginx/html/travelling

COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY app.js /usr/share/nginx/html/app.js
COPY travelling/index.html /usr/share/nginx/html/travelling/index.html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
