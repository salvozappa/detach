package session

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"detach.it/bridge/internal/buffer"
	"detach.it/bridge/internal/config"
	"detach.it/bridge/internal/types"
)

// WebSocket keepalive configuration
const (
	PongWait     = 60 * time.Second // Time to wait for pong response
	PingInterval = 15 * time.Second // Send pings at this interval
	WriteWait    = 10 * time.Second // Time to complete write operations
)

// Session represents a persistent SSH session
type Session struct {
	ID      string
	SSHConn *ssh.Client
	SSHSess *ssh.Session // LLM terminal (Claude)
	Stdin   io.WriteCloser
	Buffer  *buffer.RingBuffer
	Done    chan struct{}

	SSHSessTerminal *ssh.Session // Shell terminal (bash)
	StdinTerminal   io.WriteCloser
	BufferTerminal  *buffer.RingBuffer
	DoneTerminal    chan struct{}

	wsConn *websocket.Conn
	wsMu   sync.Mutex
}

// SetWebSocket sets the WebSocket connection for this session
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

// GetWebSocket returns the current WebSocket connection
func (s *Session) GetWebSocket() *websocket.Conn {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	return s.wsConn
}

// WriteToWebSocket writes binary data to the WebSocket
func (s *Session) WriteToWebSocket(data []byte) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil // No WebSocket connected, just buffer
	}
	s.wsConn.SetWriteDeadline(time.Now().Add(WriteWait))
	return s.wsConn.WriteMessage(websocket.BinaryMessage, data)
}

// WriteToWebSocketWithTerminal writes terminal data wrapped in a message
func (s *Session) WriteToWebSocketWithTerminal(data []byte, terminal string) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil // No WebSocket connected, just buffer
	}

	// Wrap in TerminalDataMessage with base64 encoded data
	msg := types.TerminalDataMessage{
		Type:     "terminal_data",
		Terminal: terminal,
		Data:     base64.StdEncoding.EncodeToString(data),
	}

	s.wsConn.SetWriteDeadline(time.Now().Add(WriteWait))
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
	s.wsConn.SetWriteDeadline(time.Now().Add(WriteWait))
	if err := s.wsConn.WriteMessage(websocket.PingMessage, nil); err != nil {
		return err
	}

	// Send JSON pong so JavaScript can track connection health
	s.wsConn.SetWriteDeadline(time.Now().Add(WriteWait))
	return s.wsConn.WriteJSON(map[string]string{"type": "pong"})
}

// WriteJSON writes a JSON message to the WebSocket with proper locking and deadline
func (s *Session) WriteJSON(v interface{}) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	if s.wsConn == nil {
		return nil
	}

	s.wsConn.SetWriteDeadline(time.Now().Add(WriteWait))
	return s.wsConn.WriteJSON(v)
}

// Resize changes the terminal window size
func (s *Session) Resize(terminal string, rows, cols int) error {
	var targetSess *ssh.Session
	if terminal == "terminal" {
		targetSess = s.SSHSessTerminal
	} else {
		targetSess = s.SSHSess
	}

	if err := targetSess.WindowChange(rows, cols); err != nil {
		log.Printf("Session %s failed to resize %s terminal: %v", s.ID, terminal, err)
		return err
	}
	log.Printf("Session %s %s terminal resized to %dx%d", s.ID, terminal, rows, cols)
	return nil
}

// Global session management
var globalSession *Session
var sessionMu sync.RWMutex

func generateSessionID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// Get returns the current global session
func Get() *Session {
	sessionMu.RLock()
	defer sessionMu.RUnlock()
	return globalSession
}

// Set sets the global session
func Set(s *Session) {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	globalSession = s
}

// Clear clears the global session
func Clear() {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	globalSession = nil
}

// Create creates a new SSH session with terminals
func Create(cfg *config.Config, user string) (*Session, error) {
	key, err := os.ReadFile(cfg.SSHKeyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("SSH key not found at %s - run 'make setup' to generate keys", cfg.SSHKeyPath)
		}
		return nil, fmt.Errorf("failed to read SSH key at %s: %w", cfg.SSHKeyPath, err)
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("failed to parse SSH key at %s: %w", cfg.SSHKeyPath, err)
	}

	sshConfig := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	sshAddr := fmt.Sprintf("%s:%s", cfg.SandboxHost, cfg.SandboxPort)
	sshConn, err := ssh.Dial("tcp", sshAddr, sshConfig)
	if err != nil {
		return nil, err
	}

	sshSess, err := sshConn.NewSession()
	if err != nil {
		sshConn.Close()
		return nil, err
	}

	if err := sshSess.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{}); err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stderr, err := sshSess.StderrPipe()
	if err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	// Create second PTY for shell terminal
	sshSessTerminal, err := sshConn.NewSession()
	if err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	if err := sshSessTerminal.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{}); err != nil {
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdinTerminal, err := sshSessTerminal.StdinPipe()
	if err != nil {
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdoutTerminal, err := sshSessTerminal.StdoutPipe()
	if err != nil {
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stderrTerminal, err := sshSessTerminal.StderrPipe()
	if err != nil {
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	session := &Session{
		ID:              generateSessionID(),
		SSHConn:         sshConn,
		SSHSess:         sshSess,
		Stdin:           stdin,
		Buffer:          buffer.New(32 * 1024), // 32KB buffer
		Done:            make(chan struct{}),
		SSHSessTerminal: sshSessTerminal,
		StdinTerminal:   stdinTerminal,
		BufferTerminal:  buffer.New(32 * 1024), // 32KB buffer
		DoneTerminal:    make(chan struct{}),
	}

	Set(session)

	// Start claude in LLM terminal
	log.Println("Starting claude...")
	claudeArgs := cfg.BuildClaudeArgsString()
	claudeCmd := fmt.Sprintf("bash -l -c 'cd %s && exec claude %s'", cfg.WorkingDir, claudeArgs)
	if err := sshSess.Start(claudeCmd); err != nil {
		Clear()
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Claude started successfully")

	// Start bash in shell terminal
	log.Println("Starting shell terminal...")
	terminalCmd := fmt.Sprintf("bash -l -c 'cd %s && exec bash'", cfg.WorkingDir)
	if err := sshSessTerminal.Start(terminalCmd); err != nil {
		Clear()
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Shell terminal started successfully")

	// Goroutine to forward LLM terminal stdout
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				log.Printf("Session %s LLM stdout ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.Buffer.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "llm"); err != nil {
				log.Printf("Session %s WebSocket write error (LLM stdout): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to forward LLM terminal stderr
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				log.Printf("Session %s LLM stderr ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.Buffer.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "llm"); err != nil {
				log.Printf("Session %s WebSocket write error (LLM stderr): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to forward shell terminal stdout
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdoutTerminal.Read(buf)
			if err != nil {
				log.Printf("Session %s shell terminal stdout ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.BufferTerminal.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "terminal"); err != nil {
				log.Printf("Session %s WebSocket write error (shell terminal stdout): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to forward shell terminal stderr
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderrTerminal.Read(buf)
			if err != nil {
				log.Printf("Session %s shell terminal stderr ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.BufferTerminal.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "terminal"); err != nil {
				log.Printf("Session %s WebSocket write error (shell terminal stderr): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to wait for LLM session end and cleanup
	go func() {
		sshSess.Wait()
		log.Printf("Session %s LLM terminal ended", session.ID)
		close(session.Done)
		Clear()
		sshSess.Close()
		sshSessTerminal.Close()
		sshConn.Close()
	}()

	// Goroutine to wait for shell terminal session end
	go func() {
		sshSessTerminal.Wait()
		log.Printf("Session %s shell terminal ended", session.ID)
		close(session.DoneTerminal)
	}()

	return session, nil
}

// HandleReconnect handles reconnection to an existing session
func HandleReconnect(conn *websocket.Conn, session *Session, connectionHandler func(*websocket.Conn, *Session)) {
	// Send session ID confirmation
	sessionMsg := types.SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.SetWriteDeadline(time.Now().Add(WriteWait))
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Replay LLM terminal buffer
	bufferedData := session.Buffer.GetAll()
	if len(bufferedData) > 0 {
		log.Printf("Replaying %d bytes of LLM buffer for session %s", len(bufferedData), session.ID)
		llmMsg := types.TerminalDataMessage{
			Type:     "terminal_data",
			Terminal: "llm",
			Data:     base64.StdEncoding.EncodeToString(bufferedData),
		}
		conn.SetWriteDeadline(time.Now().Add(WriteWait))
		conn.WriteJSON(llmMsg)
	}

	// Replay shell terminal buffer
	bufferedDataTerminal := session.BufferTerminal.GetAll()
	if len(bufferedDataTerminal) > 0 {
		log.Printf("Replaying %d bytes of shell terminal buffer for session %s", len(bufferedDataTerminal), session.ID)
		terminalMsg := types.TerminalDataMessage{
			Type:     "terminal_data",
			Terminal: "terminal",
			Data:     base64.StdEncoding.EncodeToString(bufferedDataTerminal),
		}
		conn.SetWriteDeadline(time.Now().Add(WriteWait))
		conn.WriteJSON(terminalMsg)
	}

	// Attach and handle connection
	connectionHandler(conn, session)
}
