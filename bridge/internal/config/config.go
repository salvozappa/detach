package config

import (
	"os"
	"strings"
)


// Config holds all configuration values
type Config struct {
	SandboxHost        string
	SandboxPort        string
	SSHKeyPath         string
	WorkingDir         string
	ClaudeArgs         []string
	TokenFilePath      string
	WebviewHost        string
	SkipAuthentication bool
}

// Load reads configuration from environment variables
func Load() *Config {
	cfg := &Config{
		SandboxHost:        getEnv("SANDBOX_HOST", "sandbox"),
		SandboxPort:        getEnv("SANDBOX_PORT", "22"),
		SSHKeyPath:         getEnv("SSH_KEY_PATH", "../keys/bridge"),
		WorkingDir:         "~/project", // Hardcoded: single-repo app
		ClaudeArgs:         parseClaudeArgs(getEnv("CLAUDE_ARGS", "--dangerously-skip-permissions")),
		TokenFilePath:      getEnv("DETACH_TOKEN_FILE", "/app/data/token"),
		WebviewHost:        getEnv("WEBVIEW_HOST", "localhost:8080"),
		SkipAuthentication: parseBool(getEnv("SKIP_AUTHENTICATION", "")),
	}

	return cfg
}

// parseClaudeArgs splits a space-separated string into arguments
func parseClaudeArgs(args string) []string {
	args = strings.TrimSpace(args)
	if args == "" {
		return []string{}
	}
	return strings.Fields(args)
}

// BuildClaudeArgsString converts the args slice to a command-line string
func (c *Config) BuildClaudeArgsString() string {
	return strings.Join(c.ClaudeArgs, " ")
}

// GetEnv returns an environment variable value or a default
func GetEnv(key, defaultValue string) string {
	return getEnv(key, defaultValue)
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// parseBool converts a string to boolean
// Returns true for: "1", "true", "True", "TRUE", "yes", "Yes", "YES"
// Returns false for everything else (including "0", "false", "no", empty string)
func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
