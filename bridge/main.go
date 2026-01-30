package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"detach.it/bridge/internal/config"
	"detach.it/bridge/internal/executor"
	"detach.it/bridge/internal/files"
	"detach.it/bridge/internal/git"
	"detach.it/bridge/internal/handler"
	"detach.it/bridge/internal/notify"
	"detach.it/bridge/internal/session"
	"detach.it/bridge/internal/types"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var cfg *config.Config
var notifyService *notify.Service

func main() {
	// Load configuration
	cfg = config.Load()

	// Initialize notification service
	notifyService = notify.NewService()
	notifyService.Init()

	// WebSocket endpoint
	http.HandleFunc("/", handleWebSocket)

	// Hook notification endpoint (called by sandbox scripts)
	http.HandleFunc("/api/hook", notifyService.HandleHookNotification)

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
	if sess := session.Get(); sess != nil {
		log.Printf("[WS] Taking over session %s from %s", sess.ID, remoteAddr)
		session.HandleReconnect(conn, sess, func(c *websocket.Conn, s *session.Session) {
			runConnectionHandler(c, s)
		})
		return
	}

	// Create new session
	sess, err := session.Create(cfg, user)
	if err != nil {
		log.Printf("[WS] Failed to create session for user %s from %s: %v", user, remoteAddr, err)
		conn.Close()
		return
	}

	log.Printf("[WS] Created new session %s for user %s from %s", sess.ID, user, remoteAddr)

	// Send session ID to client
	sessionMsg := types.SessionMessage{Type: "session", ID: sess.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.SetWriteDeadline(time.Now().Add(session.WriteWait))
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Attach WebSocket and handle connection
	runConnectionHandler(conn, sess)
}

func runConnectionHandler(conn *websocket.Conn, sess *session.Session) {
	// Create executor for this session
	exec := executor.NewSSHExecutor(sess.SSHConn)

	// Create services
	explorer := files.NewExplorer(exec, cfg.WorkingDir)
	gitSvc := git.NewService(exec, explorer, cfg.WorkingDir)

	// Create handler dependencies
	deps := &handler.Deps{
		SessionID:  sess.ID,
		Done:       sess.Done,
		Git:        gitSvc,
		Files:      explorer,
		Notify:     notifyService,
		Responder:  sess,
		Resizer:    sess,
		LLMStdin:   sess.Stdin,
		ShellStdin: sess.StdinTerminal,
	}

	// Connection configuration
	connCfg := handler.ConnectionConfig{
		PongWait:     session.PongWait,
		PingInterval: session.PingInterval,
		WriteWait:    session.WriteWait,
	}

	// Handle connection
	handler.HandleConnection(conn, deps, sess, connCfg)
}
