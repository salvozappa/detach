package config

import "os"

// Config holds all configuration values
type Config struct {
	SandboxHost string
	SandboxPort string
	SSHKeyPath  string
	WorkingDir  string
}

// Load reads configuration from environment variables with defaults
func Load() *Config {
	return &Config{
		SandboxHost: getEnv("SANDBOX_HOST", "77.42.17.162"),
		SandboxPort: getEnv("SANDBOX_PORT", "22"),
		SSHKeyPath:  getEnv("SSH_KEY_PATH", "../keys/bridge"),
		WorkingDir:  getEnv("WORKING_DIR", "~/projects/notestash"),
	}
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
