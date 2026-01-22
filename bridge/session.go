package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"io"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

// Session represents a persistent SSH session
type Session struct {
	ID      string
	SSHConn *ssh.Client
	SSHSess *ssh.Session // LLM terminal (Claude)
	Stdin   io.WriteCloser
	Buffer  *RingBuffer
	Done    chan struct{}

	SSHSessTerminal *ssh.Session   // Shell terminal (bash)
	StdinTerminal   io.WriteCloser
	BufferTerminal  *RingBuffer
	DoneTerminal    chan struct{}

	wsConn *websocket.Conn
	wsMu   sync.Mutex
}

func (s *Session) SetWebSocket(conn *websocket.Conn) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	// Close old connection if exists to prevent multiple handlers
	if s.wsConn != nil && conn != nil {
		log.Printf("[Session:%s] Closing old WebSocket before attaching new one", s.ID)
		s.wsConn.Close()
	}
	s.wsConn = conn
}

func (s *Session) GetWebSocket() *websocket.Conn {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	return s.wsConn
}

func (s *Session) WriteToWebSocket(data []byte) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil // No WebSocket connected, just buffer
	}
	s.wsConn.SetWriteDeadline(time.Now().Add(writeWait))
	return s.wsConn.WriteMessage(websocket.BinaryMessage, data)
}

func (s *Session) WriteToWebSocketWithTerminal(data []byte, terminal string) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil // No WebSocket connected, just buffer
	}

	// Wrap in TerminalDataMessage with base64 encoded data
	msg := TerminalDataMessage{
		Type:     "terminal_data",
		Terminal: terminal,
		Data:     base64.StdEncoding.EncodeToString(data),
	}

	s.wsConn.SetWriteDeadline(time.Now().Add(writeWait))
	return s.wsConn.WriteJSON(msg)
}

// SendPing sends a WebSocket ping frame and a JSON pong message for client health tracking
func (s *Session) SendPing() error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil
	}

	// Send WebSocket protocol ping
	s.wsConn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := s.wsConn.WriteMessage(websocket.PingMessage, nil); err != nil {
		return err
	}

	// Send JSON pong so JavaScript can track connection health
	s.wsConn.SetWriteDeadline(time.Now().Add(writeWait))
	return s.wsConn.WriteJSON(map[string]string{"type": "pong"})
}

// WriteJSON writes a JSON message to the WebSocket with proper locking and deadline
func (s *Session) WriteJSON(v interface{}) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil
	}

	s.wsConn.SetWriteDeadline(time.Now().Add(writeWait))
	return s.wsConn.WriteJSON(v)
}

// Single global session (one session per instance)
var globalSession *Session
var sessionMu sync.RWMutex

func generateSessionID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func getSession() *Session {
	sessionMu.RLock()
	defer sessionMu.RUnlock()
	return globalSession
}

func setSession(s *Session) {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	globalSession = s
}

func clearSession() {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	globalSession = nil
}

// Execute a command via SSH and return output
func (s *Session) executeCommand(cmd string) (string, error) {
	sess, err := s.SSHConn.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	var stdout, stderr bytes.Buffer
	sess.Stdout = &stdout
	sess.Stderr = &stderr

	if err := sess.Run(cmd); err != nil {
		return "", err
	}

	return stdout.String(), nil
}
