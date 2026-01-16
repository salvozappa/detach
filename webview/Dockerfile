FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy all webview files to nginx default location
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY lib/ /usr/share/nginx/html/lib/

# Expose HTTP port
EXPOSE 80

# nginx runs in foreground by default in the official image
CMD ["nginx", "-g", "daemon off;"]
