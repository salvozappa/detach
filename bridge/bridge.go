package main

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

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
				// Send WebSocket protocol ping and JSON pong using session's mutex
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
			// Enhanced error logging with close code parsing
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
			return
		}

		// Try to parse as JSON message
		var msg map[string]interface{}
		if err := json.Unmarshal(p, &msg); err == nil {
			msgType, _ := msg["type"].(string)

			switch msgType {
			case "terminal_data":
				var termMsg TerminalDataMessage
				json.Unmarshal(p, &termMsg)

				// Decode base64 data
				data, err := base64.StdEncoding.DecodeString(termMsg.Data)
				if err != nil {
					log.Printf("Session %s failed to decode terminal data: %v", session.ID, err)
					continue
				}

				// Route to appropriate terminal
				if termMsg.Terminal == "terminal" {
					if _, err := session.StdinTerminal.Write(data); err != nil {
						log.Printf("Session %s shell terminal stdin write error: %v", session.ID, err)
						return
					}
				} else {
					if _, err := session.Stdin.Write(data); err != nil {
						log.Printf("Session %s LLM stdin write error: %v", session.ID, err)
						return
					}
				}

			case "resize":
				var resizeMsg ResizeMessage
				json.Unmarshal(p, &resizeMsg)

				// Route resize to appropriate terminal
				var targetSess = session.SSHSess
				if resizeMsg.Terminal == "terminal" {
					targetSess = session.SSHSessTerminal
				}

				if err := targetSess.WindowChange(resizeMsg.Rows, resizeMsg.Cols); err != nil {
					log.Printf("Session %s failed to resize %s terminal: %v", session.ID, resizeMsg.Terminal, err)
				} else {
					log.Printf("Session %s %s terminal resized to %dx%d", session.ID, resizeMsg.Terminal, resizeMsg.Rows, resizeMsg.Cols)
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
				session.WriteJSON(resp)

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
				session.WriteJSON(resp)

			case "read_file_with_diff":
				var req FileRequest
				json.Unmarshal(p, &req)
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

			case "git_status":
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

			case "git_stage":
				var req GitActionRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s staging file: %s", session.ID, req.File)

				err := session.stageFile(req.File)
				resp := GitActionResponse{
					Type: "git_stage_success",
				}
				if err != nil {
					log.Printf("Stage error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				session.WriteJSON(resp)

			case "git_unstage":
				var req GitActionRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s unstaging file: %s", session.ID, req.File)

				err := session.unstageFile(req.File)
				resp := GitActionResponse{
					Type: "git_unstage_success",
				}
				if err != nil {
					log.Printf("Unstage error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				session.WriteJSON(resp)

			case "git_stage_all":
				log.Printf("Session %s staging all files", session.ID)

				err := session.stageAll()
				resp := GitActionResponse{
					Type: "git_stage_all_success",
				}
				if err != nil {
					log.Printf("Stage all error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				session.WriteJSON(resp)

			case "git_unstage_all":
				log.Printf("Session %s unstaging all files", session.ID)

				err := session.unstageAll()
				resp := GitActionResponse{
					Type: "git_unstage_all_success",
				}
				if err != nil {
					log.Printf("Unstage all error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				session.WriteJSON(resp)

			case "git_discard":
				var req GitActionRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s discarding file: %s", session.ID, req.File)

				err := session.discardFile(req.File)
				resp := GitActionResponse{
					Type: "git_discard_success",
				}
				if err != nil {
					log.Printf("Discard error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				session.WriteJSON(resp)

			case "git_commit":
				var req GitCommitRequest
				if err := json.Unmarshal(p, &req); err != nil {
					log.Printf("Error parsing git_commit request: %v", err)
					continue
				}

				log.Printf("Session %s committing with message: %s", session.ID, req.Message)

				err := session.commitChanges(req.Message)

				resp := GitActionResponse{
					Type: "git_commit_success",
				}

				if err != nil {
					log.Printf("Commit error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}

				session.WriteJSON(resp)

			case "git_pull":
				log.Printf("Session %s pulling changes", session.ID)

				err := session.pullChanges()

				resp := GitActionResponse{
					Type: "git_pull_success",
				}

				if err != nil {
					log.Printf("Pull error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}

				session.WriteJSON(resp)

			case "git_push":
				log.Printf("Session %s pushing changes", session.ID)

				err := session.pushChanges()

				resp := GitActionResponse{
					Type: "git_push_success",
				}

				if err != nil {
					log.Printf("Push error: %v", err)
					resp.Type = "git_error"
					resp.Error = err.Error()
				}

				session.WriteJSON(resp)

			case "register_fcm_token":
				var req FcmTokenMessage
				json.Unmarshal(p, &req)
				log.Printf("[FCM] Session %s registering FCM token via WebSocket: %s...", session.ID, truncateToken(req.Token))

				if req.Token != "" {
					fcmTokensMu.Lock()
					fcmTokens[session.ID] = req.Token
					fcmTokensMu.Unlock()
					log.Printf("[FCM] Registered token for session %s", session.ID)
					session.WriteJSON(map[string]string{"type": "fcm_token_registered", "status": "ok"})
				} else {
					log.Printf("[FCM] Empty token received from session %s", session.ID)
					session.WriteJSON(map[string]string{"type": "fcm_token_registered", "status": "error", "error": "empty token"})
				}

			case "register_web_push":
				var req WebPushMessage
				json.Unmarshal(p, &req)
				log.Printf("[WebPush] Session %s registering web push subscription", session.ID)

				if req.Subscription.Endpoint != "" {
					registerWebPushSubscription(session.ID, req.Subscription)
					session.WriteJSON(map[string]string{"type": "web_push_registered", "status": "ok"})
				} else {
					log.Printf("[WebPush] Empty subscription received from session %s", session.ID)
					session.WriteJSON(map[string]string{"type": "web_push_registered", "status": "error", "error": "empty subscription"})
				}

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
