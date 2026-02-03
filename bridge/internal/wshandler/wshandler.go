package wshandler

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"time"

	"github.com/gorilla/websocket"

	"detach.it/bridge/internal/types"
)

// GitService handles git operations
type GitService interface {
	Status() (*types.GitStatusResponse, error)
	Stage(file string) error
	Unstage(file string) error
	StageAll() error
	UnstageAll() error
	Discard(file string) error
	Commit(message string) error
	Pull() error
	Push() error
	FileWithDiff(path string) (*types.FileWithDiffResponse, error)
}

// FileService handles file operations
type FileService interface {
	List(path string) ([]types.FileInfo, error)
	Read(path string) (string, error)
}

// NotifyService handles web push notifications
type NotifyService interface {
	RegisterSubscription(sessionID string, sub types.WebPushSubscription)
}

// Responder sends JSON responses to the client
type Responder interface {
	WriteJSON(v interface{}) error
}

// TerminalResizer changes terminal window size
type TerminalResizer interface {
	Resize(terminal string, rows, cols int) error
}

// SessionInfo provides basic session information
type SessionInfo interface {
	GetID() string
	GetDone() <-chan struct{}
}

// Deps contains all handler dependencies
type Deps struct {
	SessionID     string
	Done          <-chan struct{}
	Git           GitService
	Files         FileService
	Notify        NotifyService
	Responder     Responder
	Resizer       TerminalResizer
	LLMStdin      io.Writer
	ShellStdin    io.Writer
}

// handleSocketError logs WebSocket errors with appropriate detail level
func handleSocketError(sessionID string, err error) {
	if closeErr, ok := err.(*websocket.CloseError); ok {
		log.Printf("[WS:%s] WebSocket close error: code=%d, text=%q", sessionID, closeErr.Code, closeErr.Text)
	} else if websocket.IsUnexpectedCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseAbnormalClosure,
		websocket.CloseNoStatusReceived) {
		log.Printf("[WS:%s] Unexpected WebSocket close: %v", sessionID, err)
	} else {
		log.Printf("[WS:%s] WebSocket read error: %v", sessionID, err)
	}
}

// HandleTerminalData routes terminal input to the appropriate SSH session
func HandleTerminalData(deps *Deps, payload []byte) bool {
	var msg types.TerminalDataMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		log.Printf("Session %s failed to parse terminal_data: %v", deps.SessionID, err)
		return true
	}

	data, err := base64.StdEncoding.DecodeString(msg.Data)
	if err != nil {
		log.Printf("Session %s failed to decode terminal data: %v", deps.SessionID, err)
		return true
	}

	if msg.Terminal == "terminal" {
		if _, err := deps.ShellStdin.Write(data); err != nil {
			log.Printf("Session %s shell terminal stdin write error: %v", deps.SessionID, err)
			return false
		}
	} else {
		if _, err := deps.LLMStdin.Write(data); err != nil {
			log.Printf("Session %s LLM stdin write error: %v", deps.SessionID, err)
			return false
		}
	}
	return true
}

// HandleResize changes the terminal window size
func HandleResize(deps *Deps, payload []byte) {
	var msg types.ResizeMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		log.Printf("Session %s failed to parse resize: %v", deps.SessionID, err)
		return
	}

	deps.Resizer.Resize(msg.Terminal, msg.Rows, msg.Cols)
}

// HandleListFiles returns directory contents
func HandleListFiles(deps *Deps, payload []byte) {
	var req types.FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse list_files: %v", deps.SessionID, err)
		return
	}

	log.Printf("Session %s listing files: %s", deps.SessionID, req.Path)

	files, err := deps.Files.List(req.Path)
	resp := types.FileListResponse{
		Type:  "file_list",
		Path:  req.Path,
		Files: files,
	}
	if err != nil {
		resp.Error = err.Error()
	}
	deps.Responder.WriteJSON(resp)
}

// HandleReadFile returns file contents
func HandleReadFile(deps *Deps, payload []byte) {
	var req types.FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse read_file: %v", deps.SessionID, err)
		return
	}

	log.Printf("Session %s reading file: %s", deps.SessionID, req.Path)

	content, err := deps.Files.Read(req.Path)
	resp := types.FileContentResponse{
		Type:    "file_content",
		Path:    req.Path,
		Content: content,
	}
	if err != nil {
		resp.Error = err.Error()
	}
	deps.Responder.WriteJSON(resp)
}

// HandleReadFileWithDiff returns file contents with git diff information
func HandleReadFileWithDiff(deps *Deps, payload []byte) {
	var req types.FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse read_file_with_diff: %v", deps.SessionID, err)
		return
	}

	log.Printf("Session %s reading file with diff: %s", deps.SessionID, req.Path)

	resp, err := deps.Git.FileWithDiff(req.Path)
	if err != nil {
		deps.Responder.WriteJSON(types.FileWithDiffResponse{
			Type:  "file_with_diff",
			Path:  req.Path,
			Error: err.Error(),
		})
	} else {
		deps.Responder.WriteJSON(resp)
	}
}

// HandleGitStatus returns the current git status
func HandleGitStatus(deps *Deps) {
	log.Printf("Session %s getting git status", deps.SessionID)

	resp, err := deps.Git.Status()
	if err != nil {
		deps.Responder.WriteJSON(types.GitActionResponse{
			Type:  "git_error",
			Error: err.Error(),
		})
	} else {
		deps.Responder.WriteJSON(resp)
	}
}

// HandleGitFileAction is a generic handler for git operations on a single file
func HandleGitFileAction(deps *Deps, payload []byte, actionName string, action func(string) error) {
	var req types.GitActionRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Error parsing %s request: %v", actionName, err)
		return
	}

	log.Printf("Session %s performing %s on: %s", deps.SessionID, actionName, req.File)

	resp := types.GitActionResponse{Type: actionName + "_success"}
	if err := action(req.File); err != nil {
		log.Printf("%s error: %v", actionName, err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	deps.Responder.WriteJSON(resp)
}

// HandleGitBulkAction is a generic handler for git operations without file arguments
func HandleGitBulkAction(deps *Deps, actionName string, action func() error) {
	log.Printf("Session %s performing %s", deps.SessionID, actionName)

	resp := types.GitActionResponse{Type: actionName + "_success"}
	if err := action(); err != nil {
		log.Printf("%s error: %v", actionName, err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	deps.Responder.WriteJSON(resp)
}

// HandleGitCommit commits staged changes with a message
func HandleGitCommit(deps *Deps, payload []byte) {
	var req types.GitCommitRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Error parsing git_commit request: %v", err)
		return
	}

	log.Printf("Session %s committing with message: %s", deps.SessionID, req.Message)

	resp := types.GitActionResponse{Type: "git_commit_success"}
	if err := deps.Git.Commit(req.Message); err != nil {
		log.Printf("Commit error: %v", err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	deps.Responder.WriteJSON(resp)
}

// HandleRegisterWebPush registers a web push subscription
func HandleRegisterWebPush(deps *Deps, payload []byte) {
	var req types.WebPushMessage
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("[WebPush] Session %s failed to parse subscription: %v", deps.SessionID, err)
		return
	}

	log.Printf("[WebPush] Session %s registering web push subscription", deps.SessionID)

	if req.Subscription.Endpoint != "" {
		deps.Notify.RegisterSubscription(deps.SessionID, req.Subscription)
		deps.Responder.WriteJSON(map[string]string{"type": "web_push_registered", "status": "ok"})
	} else {
		log.Printf("[WebPush] Empty subscription received from session %s", deps.SessionID)
		deps.Responder.WriteJSON(map[string]string{"type": "web_push_registered", "status": "error", "error": "empty subscription"})
	}
}

// HandleDebugLog forwards client-side debug logs to server stdout
func HandleDebugLog(deps *Deps, payload []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(payload, &msg); err != nil {
		return
	}

	category, _ := msg["category"].(string)
	message, _ := msg["message"].(string)
	data, _ := msg["data"].(map[string]interface{})

	if len(data) > 0 {
		log.Printf("[CLIENT:%s] %s %v", category, message, data)
	} else {
		log.Printf("[CLIENT:%s] %s", category, message)
	}
}

// ConnectionConfig holds configuration for the connection handler
type ConnectionConfig struct {
	PongWait     time.Duration
	PingInterval time.Duration
	WriteWait    time.Duration
}

// WebSocketConn wraps websocket.Conn methods we need
type WebSocketConn interface {
	SetReadDeadline(t time.Time) error
	SetPongHandler(h func(appData string) error)
	SetCloseHandler(h func(code int, text string) error)
	ReadMessage() (messageType int, p []byte, err error)
	Close() error
}

// SessionWebSocket provides session-level WebSocket operations
type SessionWebSocket interface {
	SetWebSocket(conn *websocket.Conn)
	SendPing() error
}

// HandleConnection manages the WebSocket connection lifecycle and message routing
func HandleConnection(conn *websocket.Conn, deps *Deps, sessWS SessionWebSocket, cfg ConnectionConfig) {
	connectionStart := time.Now()
	log.Printf("[WS:%s] Connection handler started", deps.SessionID)

	sessWS.SetWebSocket(conn)

	// Set up pong handler to reset read deadline
	conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
	conn.SetPongHandler(func(appData string) error {
		log.Printf("[WS:%s] Pong received, extending deadline by %v", deps.SessionID, cfg.PongWait)
		conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
		return nil
	})

	// Set up close handler for logging
	conn.SetCloseHandler(func(code int, text string) error {
		duration := time.Since(connectionStart)
		log.Printf("[WS:%s] Close handler: code=%d, reason=%q, duration=%v", deps.SessionID, code, text, duration)
		return nil
	})

	// Start ping goroutine - uses session's mutex for thread-safe writes
	stopPing := make(chan struct{})
	go func() {
		ticker := time.NewTicker(cfg.PingInterval)
		defer ticker.Stop()
		pingCount := 0
		for {
			select {
			case <-ticker.C:
				pingCount++
				log.Printf("[WS:%s] Sending ping #%d", deps.SessionID, pingCount)
				if err := sessWS.SendPing(); err != nil {
					log.Printf("[WS:%s] Ping #%d error: %v", deps.SessionID, pingCount, err)
					return
				}
				log.Printf("[WS:%s] Ping #%d sent successfully", deps.SessionID, pingCount)
			case <-stopPing:
				log.Printf("[WS:%s] Ping goroutine stopped (stopPing signal)", deps.SessionID)
				return
			case <-deps.Done:
				log.Printf("[WS:%s] Ping goroutine stopped (session done)", deps.SessionID)
				return
			}
		}
	}()

	// Cleanup on disconnect
	defer func() {
		duration := time.Since(connectionStart)
		log.Printf("[WS:%s] Cleaning up connection, duration=%v", deps.SessionID, duration)
		close(stopPing)
		sessWS.SetWebSocket(nil)
		conn.Close()
		log.Printf("[WS:%s] WebSocket disconnected (session still alive)", deps.SessionID)
	}()

	// Handle incoming WebSocket messages
	for {
		select {
		case <-deps.Done:
			return
		default:
		}

		_, p, err := conn.ReadMessage()
		if err != nil {
			handleSocketError(deps.SessionID, err)
			return
		}

		// Parse message to determine type
		var msg types.WSMessage
		if err := json.Unmarshal(p, &msg); err != nil {
			// Not valid JSON, treat as raw terminal input
			if _, err := deps.LLMStdin.Write(p); err != nil {
				log.Printf("Session %s stdin write error: %v", deps.SessionID, err)
				return
			}
			continue
		}

		// Route message to appropriate handler
		switch msg.Type {
		case types.MsgTypeTerminalData:
			if !HandleTerminalData(deps, msg.Payload) {
				return
			}

		case types.MsgTypeResize:
			HandleResize(deps, msg.Payload)

		case types.MsgTypeListFiles:
			HandleListFiles(deps, msg.Payload)

		case types.MsgTypeReadFile:
			HandleReadFile(deps, msg.Payload)

		case types.MsgTypeReadFileWithDiff:
			HandleReadFileWithDiff(deps, msg.Payload)

		case types.MsgTypeGitStatus:
			HandleGitStatus(deps)

		case types.MsgTypeGitStage:
			HandleGitFileAction(deps, msg.Payload, "git_stage", deps.Git.Stage)

		case types.MsgTypeGitUnstage:
			HandleGitFileAction(deps, msg.Payload, "git_unstage", deps.Git.Unstage)

		case types.MsgTypeGitDiscard:
			HandleGitFileAction(deps, msg.Payload, "git_discard", deps.Git.Discard)

		case types.MsgTypeGitStageAll:
			HandleGitBulkAction(deps, "git_stage_all", deps.Git.StageAll)

		case types.MsgTypeGitUnstageAll:
			HandleGitBulkAction(deps, "git_unstage_all", deps.Git.UnstageAll)

		case types.MsgTypeGitCommit:
			HandleGitCommit(deps, msg.Payload)

		case types.MsgTypeGitPull:
			HandleGitBulkAction(deps, "git_pull", deps.Git.Pull)

		case types.MsgTypeGitPush:
			HandleGitBulkAction(deps, "git_push", deps.Git.Push)

		case types.MsgTypeRegisterWebPush:
			HandleRegisterWebPush(deps, msg.Payload)

		case types.MsgTypeDebugLog:
			HandleDebugLog(deps, msg.Payload)

		default:
			// Unknown message type, treat as terminal input
			if _, err := deps.LLMStdin.Write(p); err != nil {
				log.Printf("Session %s stdin write error: %v", deps.SessionID, err)
				return
			}
		}
	}
}
