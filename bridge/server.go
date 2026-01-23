package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocket keepalive configuration
const (
	pongWait     = 60 * time.Second // Time to wait for pong response
	pingInterval = 15 * time.Second // Send pings at this interval
	writeWait    = 10 * time.Second // Time to complete write operations
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	// WebSocket endpoint
	http.HandleFunc("/", handleWebSocket)

	// Hook notification endpoint (called by sandbox scripts)
	http.HandleFunc("/api/hook", handleHookNotification)

	log.Println("Starting WebSocket server on :8081")
	if err := http.ListenAndServe(":8081", nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	remoteAddr := r.RemoteAddr
	userAgent := r.Header.Get("User-Agent")

	log.Printf("[WS] New connection attempt from %s, User-Agent: %s", remoteAddr, userAgent)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Failed to upgrade connection from %s: %v", remoteAddr, err)
		return
	}

	log.Printf("[WS] Connection upgraded successfully from %s", remoteAddr)

	user := r.URL.Query().Get("user")
	if user == "" {
		log.Printf("[WS] Missing user parameter from %s", remoteAddr)
		conn.Close()
		return
	}

	log.Printf("[WS] Connection params: user=%s, remoteAddr=%s", user, remoteAddr)

	// Check for existing session (device takeover)
	if session := getSession(); session != nil {
		log.Printf("[WS] Taking over session %s from %s", session.ID, remoteAddr)
		handleReconnect(conn, session)
		return
	}

	// Create new session
	session, err := createSession(user)
	if err != nil {
		log.Printf("[WS] Failed to create session for user %s from %s: %v", user, remoteAddr, err)
		conn.Close()
		return
	}

	log.Printf("[WS] Created new session %s for user %s from %s", session.ID, user, remoteAddr)

	// Send session ID to client
	sessionMsg := SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Attach WebSocket and handle connection
	handleConnection(conn, session)
}
