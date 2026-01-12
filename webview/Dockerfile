FROM nginx:alpine

# Copy the index.html to nginx default location
COPY index.html /usr/share/nginx/html/

# Expose HTTP port
EXPOSE 80

# nginx runs in foreground by default in the official image
CMD ["nginx", "-g", "daemon off;"]
