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
	pingInterval = 30 * time.Second // Send pings at this interval
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
	http.HandleFunc("/", handleWebSocket)
	log.Println("Starting WebSocket server on :8081")
	if err := http.ListenAndServe(":8081", nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade connection: %v", err)
		return
	}

	user := r.URL.Query().Get("user")
	if user == "" {
		log.Println("Missing user parameter")
		conn.Close()
		return
	}

	sessionID := r.URL.Query().Get("session")

	// Try to reconnect to existing session
	if sessionID != "" {
		if session := getSession(sessionID); session != nil {
			log.Printf("Reconnecting to session %s", sessionID)
			handleReconnect(conn, session)
			return
		}
		log.Printf("Session %s not found, creating new session", sessionID)
	}

	// Create new session
	session, err := createSession(user)
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		conn.Close()
		return
	}

	log.Printf("Created new session %s", session.ID)

	// Send session ID to client
	sessionMsg := SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Attach WebSocket and handle connection
	handleConnection(conn, session)
}
