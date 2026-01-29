package main

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// handleSocketError logs WebSocket errors with appropriate detail level
func handleSocketError(session *Session, err error) {
	if closeErr, ok := err.(*websocket.CloseError); ok {
		log.Printf("[WS:%s] WebSocket close error: code=%d, text=%q", session.ID, closeErr.Code, closeErr.Text)
	} else if websocket.IsUnexpectedCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseAbnormalClosure,
		websocket.CloseNoStatusReceived) {
		log.Printf("[WS:%s] Unexpected WebSocket close: %v", session.ID, err)
	} else {
		log.Printf("[WS:%s] WebSocket read error: %v", session.ID, err)
	}
}

// handleTerminalData routes terminal input to the appropriate SSH session
func handleTerminalData(session *Session, payload []byte) bool {
	var msg TerminalDataMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		log.Printf("Session %s failed to parse terminal_data: %v", session.ID, err)
		return true
	}

	data, err := base64.StdEncoding.DecodeString(msg.Data)
	if err != nil {
		log.Printf("Session %s failed to decode terminal data: %v", session.ID, err)
		return true
	}

	if msg.Terminal == "terminal" {
		if _, err := session.StdinTerminal.Write(data); err != nil {
			log.Printf("Session %s shell terminal stdin write error: %v", session.ID, err)
			return false
		}
	} else {
		if _, err := session.Stdin.Write(data); err != nil {
			log.Printf("Session %s LLM stdin write error: %v", session.ID, err)
			return false
		}
	}
	return true
}

// handleResize changes the terminal window size
func handleResize(session *Session, payload []byte) {
	var msg ResizeMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		log.Printf("Session %s failed to parse resize: %v", session.ID, err)
		return
	}

	targetSess := session.SSHSess
	if msg.Terminal == "terminal" {
		targetSess = session.SSHSessTerminal
	}

	if err := targetSess.WindowChange(msg.Rows, msg.Cols); err != nil {
		log.Printf("Session %s failed to resize %s terminal: %v", session.ID, msg.Terminal, err)
	} else {
		log.Printf("Session %s %s terminal resized to %dx%d", session.ID, msg.Terminal, msg.Rows, msg.Cols)
	}
}

// handleListFiles returns directory contents
func handleListFiles(session *Session, payload []byte) {
	var req FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse list_files: %v", session.ID, err)
		return
	}

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
	session.WriteJSON(resp)
}

// handleReadFile returns file contents
func handleReadFile(session *Session, payload []byte) {
	var req FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse read_file: %v", session.ID, err)
		return
	}

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
	session.WriteJSON(resp)
}

// handleReadFileWithDiff returns file contents with git diff information
func handleReadFileWithDiff(session *Session, payload []byte) {
	var req FileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Session %s failed to parse read_file_with_diff: %v", session.ID, err)
		return
	}

	log.Printf("Session %s reading file with diff: %s", session.ID, req.Path)

	resp, err := session.getFileWithDiff(req.Path)
	if err != nil {
		session.WriteJSON(FileWithDiffResponse{
			Type:  "file_with_diff",
			Path:  req.Path,
			Error: err.Error(),
		})
	} else {
		session.WriteJSON(resp)
	}
}

// handleGitStatus returns the current git status
func handleGitStatus(session *Session) {
	log.Printf("Session %s getting git status", session.ID)

	resp, err := session.getGitStatus()
	if err != nil {
		session.WriteJSON(GitActionResponse{
			Type:  "git_error",
			Error: err.Error(),
		})
	} else {
		session.WriteJSON(resp)
	}
}

// handleGitFileAction is a generic handler for git operations on a single file
func handleGitFileAction(session *Session, payload []byte, actionName string, action func(string) error) {
	var req GitActionRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Error parsing %s request: %v", actionName, err)
		return
	}

	log.Printf("Session %s performing %s on: %s", session.ID, actionName, req.File)

	resp := GitActionResponse{Type: actionName + "_success"}
	if err := action(req.File); err != nil {
		log.Printf("%s error: %v", actionName, err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	session.WriteJSON(resp)
}

// handleGitBulkAction is a generic handler for git operations without file arguments
func handleGitBulkAction(session *Session, actionName string, action func() error) {
	log.Printf("Session %s performing %s", session.ID, actionName)

	resp := GitActionResponse{Type: actionName + "_success"}
	if err := action(); err != nil {
		log.Printf("%s error: %v", actionName, err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	session.WriteJSON(resp)
}

// handleGitCommit commits staged changes with a message
func handleGitCommit(session *Session, payload []byte) {
	var req GitCommitRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Error parsing git_commit request: %v", err)
		return
	}

	log.Printf("Session %s committing with message: %s", session.ID, req.Message)

	resp := GitActionResponse{Type: "git_commit_success"}
	if err := session.commitChanges(req.Message); err != nil {
		log.Printf("Commit error: %v", err)
		resp.Type = "git_error"
		resp.Error = err.Error()
	}
	session.WriteJSON(resp)
}

// handleRegisterWebPush registers a web push subscription
func handleRegisterWebPush(session *Session, payload []byte) {
	var req WebPushMessage
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("[WebPush] Session %s failed to parse subscription: %v", session.ID, err)
		return
	}

	log.Printf("[WebPush] Session %s registering web push subscription", session.ID)

	if req.Subscription.Endpoint != "" {
		registerWebPushSubscription(session.ID, req.Subscription)
		session.WriteJSON(map[string]string{"type": "web_push_registered", "status": "ok"})
	} else {
		log.Printf("[WebPush] Empty subscription received from session %s", session.ID)
		session.WriteJSON(map[string]string{"type": "web_push_registered", "status": "error", "error": "empty subscription"})
	}
}

// handleDebugLog forwards client-side debug logs to server stdout
func handleDebugLog(session *Session, payload []byte) {
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

// handleConnection manages the WebSocket connection lifecycle and message routing
func handleConnection(conn *websocket.Conn, session *Session) {
	connectionStart := time.Now()
	log.Printf("[WS:%s] Connection handler started", session.ID)

	session.SetWebSocket(conn)

	// Set up pong handler to reset read deadline
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(appData string) error {
		log.Printf("[WS:%s] Pong received, extending deadline by %v", session.ID, pongWait)
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Set up close handler for logging
	conn.SetCloseHandler(func(code int, text string) error {
		duration := time.Since(connectionStart)
		log.Printf("[WS:%s] Close handler: code=%d, reason=%q, duration=%v", session.ID, code, text, duration)
		return nil
	})

	// Start ping goroutine - uses session's mutex for thread-safe writes
	stopPing := make(chan struct{})
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		pingCount := 0
		for {
			select {
			case <-ticker.C:
				pingCount++
				log.Printf("[WS:%s] Sending ping #%d", session.ID, pingCount)
				if err := session.SendPing(); err != nil {
					log.Printf("[WS:%s] Ping #%d error: %v", session.ID, pingCount, err)
					return
				}
				log.Printf("[WS:%s] Ping #%d sent successfully", session.ID, pingCount)
			case <-stopPing:
				log.Printf("[WS:%s] Ping goroutine stopped (stopPing signal)", session.ID)
				return
			case <-session.Done:
				log.Printf("[WS:%s] Ping goroutine stopped (session done)", session.ID)
				return
			}
		}
	}()

	// Cleanup on disconnect
	defer func() {
		duration := time.Since(connectionStart)
		log.Printf("[WS:%s] Cleaning up connection, duration=%v", session.ID, duration)
		close(stopPing)
		session.SetWebSocket(nil)
		conn.Close()
		log.Printf("[WS:%s] WebSocket disconnected (session still alive)", session.ID)
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
			handleSocketError(session, err)
			return
		}

		// Parse message to determine type
		var msg WSMessage
		if err := json.Unmarshal(p, &msg); err != nil {
			// Not valid JSON, treat as raw terminal input
			if _, err := session.Stdin.Write(p); err != nil {
				log.Printf("Session %s stdin write error: %v", session.ID, err)
				return
			}
			continue
		}

		// Route message to appropriate handler
		switch msg.Type {
		case MsgTypeTerminalData:
			if !handleTerminalData(session, msg.Payload) {
				return
			}

		case MsgTypeResize:
			handleResize(session, msg.Payload)

		case MsgTypeListFiles:
			handleListFiles(session, msg.Payload)

		case MsgTypeReadFile:
			handleReadFile(session, msg.Payload)

		case MsgTypeReadFileWithDiff:
			handleReadFileWithDiff(session, msg.Payload)

		case MsgTypeGitStatus:
			handleGitStatus(session)

		case MsgTypeGitStage:
			handleGitFileAction(session, msg.Payload, "git_stage", session.stageFile)

		case MsgTypeGitUnstage:
			handleGitFileAction(session, msg.Payload, "git_unstage", session.unstageFile)

		case MsgTypeGitDiscard:
			handleGitFileAction(session, msg.Payload, "git_discard", session.discardFile)

		case MsgTypeGitStageAll:
			handleGitBulkAction(session, "git_stage_all", session.stageAll)

		case MsgTypeGitUnstageAll:
			handleGitBulkAction(session, "git_unstage_all", session.unstageAll)

		case MsgTypeGitCommit:
			handleGitCommit(session, msg.Payload)

		case MsgTypeGitPull:
			handleGitBulkAction(session, "git_pull", session.pullChanges)

		case MsgTypeGitPush:
			handleGitBulkAction(session, "git_push", session.pushChanges)

		case MsgTypeRegisterWebPush:
			handleRegisterWebPush(session, msg.Payload)

		case MsgTypeDebugLog:
			handleDebugLog(session, msg.Payload)

		default:
			// Unknown message type, treat as terminal input
			if _, err := session.Stdin.Write(p); err != nil {
				log.Printf("Session %s stdin write error: %v", session.ID, err)
				return
			}
		}
	}
}
