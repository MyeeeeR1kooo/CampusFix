FROM nginx:1.28.0-alpine
ARG FRONTEND_DIST=deploy/web/bootstrap
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY ${FRONTEND_DIST}/ /usr/share/nginx/html/
