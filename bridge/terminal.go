package main

import (
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
	claudeCmd := fmt.Sprintf("bash -l -c 'cd %s && exec claude'", workingDir)
	if err := sshSess.Start(claudeCmd); err != nil {
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
