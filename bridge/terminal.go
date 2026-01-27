package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

func createSession(user string) (*Session, error) {
	key, err := os.ReadFile(sshKeyPath)
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

	sshAddr := fmt.Sprintf("%s:%s", sandboxHost, sandboxPort)
	sshConn, err := ssh.Dial("tcp", sshAddr, config)
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
		Buffer:          NewRingBuffer(32 * 1024), // 32KB buffer
		Done:            make(chan struct{}),
		SSHSessTerminal: sshSessTerminal,
		StdinTerminal:   stdinTerminal,
		BufferTerminal:  NewRingBuffer(32 * 1024), // 32KB buffer
		DoneTerminal:    make(chan struct{}),
	}

	setSession(session)

	// Start claude in LLM terminal
	log.Println("Starting claude...")
	claudeCmd := fmt.Sprintf("bash -l -c 'cd %s && exec claude --dangerously-skip-permissions'", workingDir)
	if err := sshSess.Start(claudeCmd); err != nil {
		clearSession()
		sshSessTerminal.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Claude started successfully")

	// Start bash in shell terminal
	log.Println("Starting shell terminal...")
	terminalCmd := fmt.Sprintf("bash -l -c 'cd %s && exec bash'", workingDir)
	if err := sshSessTerminal.Start(terminalCmd); err != nil {
		clearSession()
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
		clearSession()
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

func handleReconnect(conn *websocket.Conn, session *Session) {
	// Send session ID confirmation
	sessionMsg := SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	conn.WriteMessage(websocket.TextMessage, msgBytes)

	// Replay LLM terminal buffer
	bufferedData := session.Buffer.GetAll()
	if len(bufferedData) > 0 {
		log.Printf("Replaying %d bytes of LLM buffer for session %s", len(bufferedData), session.ID)
		llmMsg := TerminalDataMessage{
			Type:     "terminal_data",
			Terminal: "llm",
			Data:     base64.StdEncoding.EncodeToString(bufferedData),
		}
		conn.SetWriteDeadline(time.Now().Add(writeWait))
		conn.WriteJSON(llmMsg)
	}

	// Replay shell terminal buffer
	bufferedDataTerminal := session.BufferTerminal.GetAll()
	if len(bufferedDataTerminal) > 0 {
		log.Printf("Replaying %d bytes of shell terminal buffer for session %s", len(bufferedDataTerminal), session.ID)
		terminalMsg := TerminalDataMessage{
			Type:     "terminal_data",
			Terminal: "terminal",
			Data:     base64.StdEncoding.EncodeToString(bufferedDataTerminal),
		}
		conn.SetWriteDeadline(time.Now().Add(writeWait))
		conn.WriteJSON(terminalMsg)
	}

	// Attach and handle connection
	handleConnection(conn, session)
}
