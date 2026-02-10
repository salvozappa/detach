package config

import (
	"encoding/json"
	"os"
	"strings"
)

// DetachConfig represents the detach.json configuration file
type DetachConfig struct {
	RepoURL    string   `json:"repo_url"`
	GitName    string   `json:"git_name,omitempty"`
	GitEmail   string   `json:"git_email,omitempty"`
	ClaudeArgs []string `json:"claude_args"`
}

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

// Default path for detach.json (can be overridden via env)
const defaultDetachConfigPath = "/app/config/detach.json"

// Load reads configuration from environment variables and detach.json
func Load() *Config {
	cfg := &Config{
		SandboxHost:        getEnv("SANDBOX_HOST", "77.42.17.162"),
		SandboxPort:        getEnv("SANDBOX_PORT", "22"),
		SSHKeyPath:         getEnv("SSH_KEY_PATH", "../keys/bridge"),
		WorkingDir:         "~/project", // Hardcoded: single-repo app
		ClaudeArgs:         []string{"--dangerously-skip-permissions"},
		TokenFilePath:      getEnv("DETACH_TOKEN_FILE", "/app/data/token"),
		WebviewHost:        getEnv("WEBVIEW_HOST", "localhost:8080"),
		SkipAuthentication: parseBool(getEnv("SKIP_AUTHENTICATION", "")),
	}

	// Load detach.json if it exists
	configPath := getEnv("DETACH_CONFIG_PATH", defaultDetachConfigPath)
	if detachCfg, err := loadDetachConfig(configPath); err == nil {
		if len(detachCfg.ClaudeArgs) > 0 {
			cfg.ClaudeArgs = detachCfg.ClaudeArgs
		}
	}

	return cfg
}

// loadDetachConfig reads and parses detach.json
func loadDetachConfig(path string) (*DetachConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg DetachConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
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
