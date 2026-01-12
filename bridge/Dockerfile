FROM golang:alpine AS builder

# Install build dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /build

# Copy go module files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY *.go ./

# Build the application
# CGO_ENABLED=0 for static binary
# -a forces rebuilding of packages
# -installsuffix cgo for static linking
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bridge .

# Final stage - minimal runtime image
FROM alpine:latest

# Install ca-certificates for HTTPS connections (if needed)
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /build/bridge .

# Create directory for SSH keys (will be mounted as volume)
RUN mkdir -p /app/keys

# Expose WebSocket port
EXPOSE 8081

# Run the bridge service
CMD ["./bridge"]
