package main

import "os"

// Configuration from environment variables
var (
	sandboxHost = getEnv("SANDBOX_HOST", "77.42.17.162")
	sandboxPort = getEnv("SANDBOX_PORT", "22")
	sshKeyPath  = getEnv("SSH_KEY_PATH", "../keys/bridge")
	workingDir  = getEnv("WORKING_DIR", "~/projects/sample")
)

// Helper function to get environment variables with defaults
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
