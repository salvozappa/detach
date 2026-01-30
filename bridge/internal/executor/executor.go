package executor

import (
	"bytes"
	"fmt"

	"golang.org/x/crypto/ssh"
)

// Executor runs commands and returns output
type Executor interface {
	Run(cmd string) (string, error)
}

// SSHExecutor implements Executor via an SSH connection
type SSHExecutor struct {
	client *ssh.Client
}

// NewSSHExecutor creates an executor that runs commands over SSH
func NewSSHExecutor(client *ssh.Client) *SSHExecutor {
	return &SSHExecutor{client: client}
}

// Run executes a command and returns stdout
func (e *SSHExecutor) Run(cmd string) (string, error) {
	sess, err := e.client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	var stdout, stderr bytes.Buffer
	sess.Stdout = &stdout
	sess.Stderr = &stderr

	if err := sess.Run(cmd); err != nil {
		// Include stderr in error message for better diagnostics
		if stderr.Len() > 0 {
			return "", fmt.Errorf("%v: %s", err, stderr.String())
		}
		return "", err
	}

	return stdout.String(), nil
}
