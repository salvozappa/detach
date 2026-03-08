# Authentication Spec

## Overview

Detach uses token-based authentication for pairing mobile devices with a self-hosted instance. This approach is simple, secure for single-user scenarios, and avoids the complexity of account systems or OAuth.

**Design goals:**
- Zero-config for users (token auto-generated)
- Mobile-friendly pairing (QR code support)
- Persistent sessions (don't re-auth on every visit)
- Secure enough for internet-exposed instances

---

## Pairing Flow

### First-time setup

1. User starts instance: `docker-compose up`
2. Bridge generates a secure token on first startup
3. Logs display pairing URL and QR code:
   ```
   =============================================
   Pair your device by opening this URL:
   https://your-host:8080?token=a8f3b2c1d4e5f6...

   Or scan this QR code:
   █████████████████████████
   ██ ▄▄▄▄▄ █ ▄▄▄█ ▄▄▄▄▄ ██
   ██ █   █ █ ███ █   █ ██
   ...
   =============================================
   ```
4. User scans QR code or types URL on mobile device
5. Frontend stores token in localStorage
6. Device is now "paired" - future visits auto-authenticate

### Returning visits

1. User opens the app URL (no token in URL needed)
2. Frontend reads token from localStorage
3. WebSocket connection includes token
4. Bridge validates token and allows connection

---

## Token Specification

### Generation

- **Algorithm:** 32 bytes from cryptographically secure random source
- **Encoding:** Base64 URL-safe (no padding), ~43 characters
- **Example:** `a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9`

### Storage (server-side)

- **Location:** `/app/data/token` (inside the bridge container), configurable via `DETACH_TOKEN_FILE` env var
- **Permissions:** `0600` (owner read/write only)
- **Format:** Plain text, single line, no whitespace
- **Persistence:** Token survives container restarts via volume mount

### Storage (client-side)

- **Location:** `localStorage.getItem('detach_token')`
- **Lifetime:** Persistent until cleared or token rotated

---

## WebSocket Authentication

### Connection handshake

Token is passed as a query parameter on WebSocket upgrade:

```
wss://host:8081/ws?token=a8f3b2c1d4e5f6...
```

### Validation

Bridge validates on every WebSocket upgrade request:

1. Extract `token` query parameter
2. Compare against stored token (constant-time comparison)
3. If valid: proceed with connection
4. If invalid/missing: close connection with `4001 Unauthorized`

### Close codes

| Code | Meaning |
|------|---------|
| 4001 | Missing or invalid token |
| 4002 | Token expired (future: if we add expiration) |

---

## Token Management

### Regenerate token

For security (e.g., token leaked), delete the token file and restart the bridge container. A new token will be generated automatically:

```bash
docker exec detach-bridge rm /app/data/token
docker-compose restart bridge
```

This invalidates all previously paired devices. The new pairing URL and QR code will be shown in the bridge logs.

### Environment override

For advanced users, token can be set via environment variable:

```yaml
# docker-compose.yml
environment:
  DETACH_TOKEN: "my-custom-token"
```

If set, this takes precedence over the token file.

### Skip authentication (development only)

For local development, authentication can be disabled entirely:

```yaml
# docker-compose.yml
environment:
  SKIP_AUTHENTICATION: "1"
```

When enabled, the bridge will:
- Skip token validation on WebSocket connections
- Not generate or load authentication tokens
- Display a warning that authentication is disabled

⚠️ **WARNING:** This is insecure and should **only** be used for local development. Never use this in production or internet-exposed instances.

---

## Frontend Implementation

### Token extraction from URL

On page load:

```javascript
const urlParams = new URLSearchParams(window.location.search);
const tokenFromUrl = urlParams.get('token');

if (tokenFromUrl) {
  localStorage.setItem('detach_token', tokenFromUrl);
  // Remove token from URL (clean up address bar)
  window.history.replaceState({}, '', window.location.pathname);
}
```

### WebSocket connection

```javascript
const token = localStorage.getItem('detach_token');
if (!token) {
  showPairingRequired(); // Display "scan QR to pair" message
  return;
}

const ws = new WebSocket(`wss://${host}:8081/ws?token=${token}`);

ws.onclose = (event) => {
  if (event.code === 4001) {
    localStorage.removeItem('detach_token');
    showPairingRequired();
  }
};
```

### Unpaired state UI

When no token is stored, frontend displays:

```
Not paired

Scan the QR code shown in your server logs,
or open the pairing URL on this device.
```

---

## Bridge Implementation

### Startup sequence

```go
func main() {
    token := loadOrGenerateToken()
    printPairingInfo(token)
    startServer(token)
}

func loadOrGenerateToken() string {
    // 1. Check DETACH_TOKEN env var
    // 2. Check token file
    // 3. Generate new token and save to file
}
```

### WebSocket upgrade handler

```go
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
    token := r.URL.Query().Get("token")

    if !secureCompare(token, expectedToken) {
        // Reject upgrade
        w.WriteHeader(http.StatusUnauthorized)
        return
    }

    // Proceed with upgrade
    upgrader.Upgrade(w, r, nil)
}
```

### QR code generation

Use `github.com/mdp/qrterminal` or similar:

```go
import "github.com/mdp/qrterminal/v3"

func printPairingInfo(token string) {
    url := fmt.Sprintf("https://%s:%d?token=%s", host, port, token)

    fmt.Println("Pair your device:")
    fmt.Println(url)
    fmt.Println()
    qrterminal.Generate(url, qrterminal.L, os.Stdout)
}
```

---

## Security Considerations

### Token entropy

32 bytes = 256 bits of entropy. Brute-forcing is infeasible.

### Transport security

- **Requirement:** HTTPS/WSS for production deployments
- **Local development:** HTTP/WS acceptable on localhost/tailnet

### Token in URL

Tokens in URLs can leak via:
- Browser history
- Server access logs
- Referrer headers

Mitigations:
- Frontend removes token from URL immediately after storing
- Token is only in URL once (pairing), not on every request
- Access logs should be protected (self-hosted, single user)

### Constant-time comparison

Use `crypto/subtle.ConstantTimeCompare` (Go) or equivalent to prevent timing attacks.

---

## Future Considerations

Not planned for v1, but potential enhancements:

- **Token expiration:** Optional TTL on tokens
- **Multiple tokens:** Allow multiple paired devices with individual revocation
- **WebAuthn/Passkeys:** Hardware key support for high-security setups
- **Audit log:** Record authentication attempts
