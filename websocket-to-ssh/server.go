package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// RingBuffer stores recent output for replay on reconnect
type RingBuffer struct {
	data []byte
	size int
	mu   sync.Mutex
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{
		data: make([]byte, 0, size),
		size: size,
	}
}

func (rb *RingBuffer) Write(p []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.data = append(rb.data, p...)
	if len(rb.data) > rb.size {
		rb.data = rb.data[len(rb.data)-rb.size:]
	}
}

func (rb *RingBuffer) GetAll() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	result := make([]byte, len(rb.data))
	copy(result, rb.data)
	return result
}

// Session represents a persistent SSH session
type Session struct {
	ID      string
	SSHConn *ssh.Client
	SSHSess *ssh.Session
	Stdin   io.WriteCloser
	Buffer  *RingBuffer
	Done    chan struct{}

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

// Message types
type ResizeMessage struct {
	Type string `json:"type"`
	Rows int    `json:"rows"`
	Cols int    `json:"cols"`
}

type SessionMessage struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// File operation messages
type FileRequest struct {
	Type string `json:"type"` // "list_files" or "read_file"
	Path string `json:"path"`
}

type FileInfo struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

type FileListResponse struct {
	Type  string     `json:"type"` // "file_list"
	Path  string     `json:"path"`
	Files []FileInfo `json:"files"`
	Error string     `json:"error,omitempty"`
}

type FileContentResponse struct {
	Type    string `json:"type"` // "file_content"
	Path    string `json:"path"`
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
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
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Attach WebSocket and handle connection
	handleConnection(conn, session)
}

func createSession(user string) (*Session, error) {
	key, err := os.ReadFile("../keys/dev")
	if err != nil {
		return nil, err
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	sshConn, err := ssh.Dial("tcp", "77.42.17.162:22", config)
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

	session := &Session{
		ID:      generateSessionID(),
		SSHConn: sshConn,
		SSHSess: sshSess,
		Stdin:   stdin,
		Buffer:  NewRingBuffer(32 * 1024), // 32KB buffer
		Done:    make(chan struct{}),
	}

	addSession(session)

	// Start claude
	log.Println("Starting claude...")
	if err := sshSess.Start("bash -l -c 'cd ~/projects/sample && exec claude'"); err != nil {
		removeSession(session.ID)
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Claude started successfully")

	// Goroutine to forward stdout (runs independently of WebSocket)
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				log.Printf("Session %s stdout ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.Buffer.Write(data)
			if err := session.WriteToWebSocket(data); err != nil {
				log.Printf("Session %s WebSocket write error (stdout): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to forward stderr (runs independently of WebSocket)
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				log.Printf("Session %s stderr ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.Buffer.Write(data)
			if err := session.WriteToWebSocket(data); err != nil {
				log.Printf("Session %s WebSocket write error (stderr): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to wait for session end and cleanup
	go func() {
		sshSess.Wait()
		log.Printf("Session %s ended", session.ID)
		close(session.Done)
		removeSession(session.ID)
		sshSess.Close()
		sshConn.Close()
	}()

	return session, nil
}

func handleReconnect(conn *websocket.Conn, session *Session) {
	// Send session ID confirmation
	sessionMsg := SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Replay buffer
	bufferedData := session.Buffer.GetAll()
	if len(bufferedData) > 0 {
		log.Printf("Replaying %d bytes of buffer for session %s", len(bufferedData), session.ID)
		conn.WriteMessage(websocket.BinaryMessage, bufferedData)
	}

	// Attach and handle connection
	handleConnection(conn, session)
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

// List files in a directory
func (s *Session) listFiles(path string) ([]FileInfo, error) {
	// Use ls -la with specific format for parsing
	output, err := s.executeCommand("ls -la " + path)
	if err != nil {
		return nil, err
	}

	var files []FileInfo
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total") {
			continue
		}

		// Parse ls -la output: drwxr-xr-x 2 user group 4096 Jan 1 12:00 filename
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}

		name := strings.Join(fields[8:], " ")
		if name == "." || name == ".." {
			continue
		}

		isDir := strings.HasPrefix(fields[0], "d")
		size, _ := strconv.ParseInt(fields[4], 10, 64)

		files = append(files, FileInfo{
			Name:  name,
			IsDir: isDir,
			Size:  size,
		})
	}

	return files, nil
}

// Read file content
func (s *Session) readFile(path string) (string, error) {
	return s.executeCommand("cat " + path)
}

func handleConnection(conn *websocket.Conn, session *Session) {
	session.SetWebSocket(conn)

	// Cleanup on disconnect
	defer func() {
		session.SetWebSocket(nil)
		conn.Close()
		log.Printf("WebSocket disconnected from session %s (session still alive)", session.ID)
	}()

	// Handle incoming WebSocket messages
	for {
		select {
		case <-session.Done:
			return
		default:
		}

		_, p, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Session %s WebSocket read error: %v", session.ID, err)
			return
		}

		// Try to parse as JSON message
		var msg map[string]interface{}
		if err := json.Unmarshal(p, &msg); err == nil {
			msgType, _ := msg["type"].(string)

			switch msgType {
			case "resize":
				var resizeMsg ResizeMessage
				json.Unmarshal(p, &resizeMsg)
				if err := session.SSHSess.WindowChange(resizeMsg.Rows, resizeMsg.Cols); err != nil {
					log.Printf("Session %s failed to resize: %v", session.ID, err)
				} else {
					log.Printf("Session %s resized to %dx%d", session.ID, resizeMsg.Rows, resizeMsg.Cols)
				}

			case "list_files":
				var req FileRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s listing files: %s", session.ID, req.Path)

				files, err := session.listFiles(req.Path)
				resp := FileListResponse{
					Type:  "file_list",
					Path:  req.Path,
					Files: files,
				}
				if err != nil {
					resp.Error = err.Error()
				}
				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

			case "read_file":
				var req FileRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s reading file: %s", session.ID, req.Path)

				content, err := session.readFile(req.Path)
				resp := FileContentResponse{
					Type:    "file_content",
					Path:    req.Path,
					Content: content,
				}
				if err != nil {
					resp.Error = err.Error()
				}
				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

			default:
				// Unknown JSON message, might be terminal input
				if _, err := session.Stdin.Write(p); err != nil {
					log.Printf("Session %s stdin write error: %v", session.ID, err)
					return
				}
			}
		} else {
			// Not JSON, treat as terminal input
			if _, err := session.Stdin.Write(p); err != nil {
				log.Printf("Session %s stdin write error: %v", session.ID, err)
				return
			}
		}
	}
}
