package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

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

type ResizeMessage struct {
	Type string `json:"type"`
	Rows int    `json:"rows"`
	Cols int    `json:"cols"`
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
	defer conn.Close()

	user := r.URL.Query().Get("user")
	if user == "" {
		log.Println("Missing user parameter")
		return
	}

	key, err := os.ReadFile("../keys/dev")
	if err != nil {
		log.Printf("Failed to read private key: %v", err)
		return
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		log.Printf("Failed to parse private key: %v", err)
		return
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
		log.Printf("Failed to dial SSH: %v", err)
		return
	}
	defer sshConn.Close()

	session, err := sshConn.NewSession()
	if err != nil {
		log.Printf("Failed to create SSH session: %v", err)
		return
	}
	defer session.Close()

	// Request PTY with default size (will be updated by resize messages from client)
	if err := session.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{}); err != nil {
		log.Printf("Failed to request PTY: %v", err)
		return
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		log.Printf("Failed to get stdin pipe: %v", err)
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		log.Printf("Failed to get stdout pipe: %v", err)
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		log.Printf("Failed to get stderr pipe: %v", err)
		return
	}

	// Start claude in ~/projects/sample directory
	log.Println("Starting claude...")
	if err := session.Start("bash -l -c 'cd ~/projects/sample && exec claude'"); err != nil {
		log.Printf("Failed to start claude: %v", err)
		return
	}
	log.Println("Claude started successfully")

	// Channel to signal when session ends
	done := make(chan error, 1)
	go func() {
		done <- session.Wait()
	}()

	// Handle incoming WebSocket messages (terminal input or resize commands)
	go func() {
		for {
			_, p, err := conn.ReadMessage()
			if err != nil {
				log.Printf("WebSocket read error: %v", err)
				return
			}

			// Check if this is a resize message
			var resizeMsg ResizeMessage
			if err := json.Unmarshal(p, &resizeMsg); err == nil && resizeMsg.Type == "resize" {
				// Handle terminal resize
				if err := session.WindowChange(resizeMsg.Rows, resizeMsg.Cols); err != nil {
					log.Printf("Failed to resize terminal: %v", err)
				} else {
					log.Printf("Terminal resized to %dx%d", resizeMsg.Rows, resizeMsg.Cols)
				}
			} else {
				// Regular terminal input
				if _, err := stdin.Write(p); err != nil {
					log.Printf("Stdin write error: %v", err)
					return
				}
			}
		}
	}()

	// Forward stdout to WebSocket
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				log.Printf("Stdout read ended: %v", err)
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				log.Printf("WebSocket write error (stdout): %v", err)
				return
			}
		}
	}()

	// Forward stderr to WebSocket
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				log.Printf("Stderr read ended: %v", err)
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				log.Printf("WebSocket write error (stderr): %v", err)
				return
			}
		}
	}()

	// Wait for session to end
	err = <-done
	if err != nil {
		log.Printf("Session ended with error: %v", err)
	} else {
		log.Println("Session ended normally")
	}
}
