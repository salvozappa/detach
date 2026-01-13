package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"

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

	// Create second PTY for Run terminal
	sshSessRun, err := sshConn.NewSession()
	if err != nil {
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	if err := sshSessRun.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{}); err != nil {
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdinRun, err := sshSessRun.StdinPipe()
	if err != nil {
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stdoutRun, err := sshSessRun.StdoutPipe()
	if err != nil {
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	stderrRun, err := sshSessRun.StderrPipe()
	if err != nil {
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}

	session := &Session{
		ID:         generateSessionID(),
		SSHConn:    sshConn,
		SSHSess:    sshSess,
		Stdin:      stdin,
		Buffer:     NewRingBuffer(32 * 1024), // 32KB buffer
		Done:       make(chan struct{}),
		SSHSessRun: sshSessRun,
		StdinRun:   stdinRun,
		BufferRun:  NewRingBuffer(32 * 1024), // 32KB buffer
		DoneRun:    make(chan struct{}),
	}

	addSession(session)

	// Start claude in LLM terminal
	log.Println("Starting claude...")
	claudeCmd := fmt.Sprintf("bash -l -c 'cd %s && exec claude'", workingDir)
	if err := sshSess.Start(claudeCmd); err != nil {
		removeSession(session.ID)
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Claude started successfully")

	// Start bash in Run terminal
	log.Println("Starting Run terminal...")
	runCmd := fmt.Sprintf("bash -l -c 'cd %s && exec bash'", workingDir)
	if err := sshSessRun.Start(runCmd); err != nil {
		removeSession(session.ID)
		sshSessRun.Close()
		sshSess.Close()
		sshConn.Close()
		return nil, err
	}
	log.Println("Run terminal started successfully")

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

	// Goroutine to forward Run terminal stdout
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdoutRun.Read(buf)
			if err != nil {
				log.Printf("Session %s Run stdout ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.BufferRun.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "run"); err != nil {
				log.Printf("Session %s WebSocket write error (Run stdout): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to forward Run terminal stderr
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderrRun.Read(buf)
			if err != nil {
				log.Printf("Session %s Run stderr ended: %v", session.ID, err)
				return
			}
			data := buf[:n]
			session.BufferRun.Write(data)
			if err := session.WriteToWebSocketWithTerminal(data, "run"); err != nil {
				log.Printf("Session %s WebSocket write error (Run stderr): %v", session.ID, err)
			}
		}
	}()

	// Goroutine to wait for LLM session end and cleanup
	go func() {
		sshSess.Wait()
		log.Printf("Session %s LLM terminal ended", session.ID)
		close(session.Done)
		removeSession(session.ID)
		sshSess.Close()
		sshSessRun.Close()
		sshConn.Close()
	}()

	// Goroutine to wait for Run session end
	go func() {
		sshSessRun.Wait()
		log.Printf("Session %s Run terminal ended", session.ID)
		close(session.DoneRun)
	}()

	return session, nil
}

func handleReconnect(conn *websocket.Conn, session *Session) {
	// Send session ID confirmation
	sessionMsg := SessionMessage{Type: "session", ID: session.ID}
	msgBytes, _ := json.Marshal(sessionMsg)
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
		conn.WriteJSON(llmMsg)
	}

	// Replay Run terminal buffer
	bufferedDataRun := session.BufferRun.GetAll()
	if len(bufferedDataRun) > 0 {
		log.Printf("Replaying %d bytes of Run buffer for session %s", len(bufferedDataRun), session.ID)
		runMsg := TerminalDataMessage{
			Type:     "terminal_data",
			Terminal: "run",
			Data:     base64.StdEncoding.EncodeToString(bufferedDataRun),
		}
		conn.WriteJSON(runMsg)
	}

	// Attach and handle connection
	handleConnection(conn, session)
}
