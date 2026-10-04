FROM nginx:alpine

# Static app only. server.py (the Demucs separation API) is intentionally not
# shipped: it accepts unauthenticated uploads and runs CPU-heavy jobs, which
# doesn't belong on a public host. Everything else works without it.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY demo /usr/share/nginx/html/demo

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
