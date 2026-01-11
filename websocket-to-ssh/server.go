package main

import (
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

	if err := session.RequestPty("xterm", 80, 40, ssh.TerminalModes{}); err != nil {
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

	if err := session.Shell(); err != nil {
		log.Printf("Failed to start shell: %v", err)
		return
	}

	go func() {
		for {
			_, p, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if _, err := stdin.Write(p); err != nil {
				return
			}
		}
	}()

	for {
		buf := make([]byte, 1024)
		n, err := stdout.Read(buf)
		if err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
			return
		}
	}
}
