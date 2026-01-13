package main

import (
	"encoding/base64"
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
)

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

			case "git_status":
				log.Printf("Session %s getting git status", session.ID)
				resp, err := session.getGitStatus()
				if err != nil {
					errResp := GitActionResponse{
						Type:  "git_error",
						Error: err.Error(),
					}
					respBytes, _ := json.Marshal(errResp)
					conn.WriteMessage(websocket.TextMessage, respBytes)
				} else {
					respBytes, _ := json.Marshal(resp)
					conn.WriteMessage(websocket.TextMessage, respBytes)
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
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

			case "git_unstage":
				var req GitActionRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s unstaging file: %s", session.ID, req.File)

				err := session.unstageFile(req.File)
				resp := GitActionResponse{
					Type: "git_unstage_success",
				}
				if err != nil {
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

			case "git_discard":
				var req GitActionRequest
				json.Unmarshal(p, &req)
				log.Printf("Session %s discarding file: %s", session.ID, req.File)

				err := session.discardFile(req.File)
				resp := GitActionResponse{
					Type: "git_discard_success",
				}
				if err != nil {
					resp.Type = "git_error"
					resp.Error = err.Error()
				}
				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

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

				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

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

				respBytes, _ := json.Marshal(resp)
				conn.WriteMessage(websocket.TextMessage, respBytes)

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
