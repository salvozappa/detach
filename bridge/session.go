package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"io"
	"sync"

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

	return s.wsConn.WriteJSON(msg)
}

// Session store
var sessions = make(map[string]*Session)
var sessionsMu sync.RWMutex

func generateSessionID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func getSession(id string) *Session {
	sessionsMu.RLock()
	defer sessionsMu.RUnlock()
	return sessions[id]
}

func addSession(s *Session) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	sessions[s.ID] = s
}

func removeSession(id string) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	delete(sessions, id)
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
