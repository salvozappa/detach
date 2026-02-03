package config

import (
	"os"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Save and clear relevant env vars
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH", "WORKING_DIR"}
	saved := make(map[string]string)
	for _, key := range envVars {
		saved[key] = os.Getenv(key)
		os.Unsetenv(key)
	}
	defer func() {
		for key, val := range saved {
			if val != "" {
				os.Setenv(key, val)
			}
		}
	}()

	cfg := Load()

	if cfg.SandboxHost != "77.42.17.162" {
		t.Errorf("expected default SandboxHost '77.42.17.162', got %q", cfg.SandboxHost)
	}
	if cfg.SandboxPort != "22" {
		t.Errorf("expected default SandboxPort '22', got %q", cfg.SandboxPort)
	}
	if cfg.SSHKeyPath != "../keys/bridge" {
		t.Errorf("expected default SSHKeyPath '../keys/bridge', got %q", cfg.SSHKeyPath)
	}
	if cfg.WorkingDir != "~/projects/notestash" {
		t.Errorf("expected default WorkingDir '~/projects/notestash', got %q", cfg.WorkingDir)
	}
}

func TestLoad_OverrideFromEnv(t *testing.T) {
	// Save current values
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH", "WORKING_DIR"}
	saved := make(map[string]string)
	for _, key := range envVars {
		saved[key] = os.Getenv(key)
	}
	defer func() {
		for key, val := range saved {
			if val != "" {
				os.Setenv(key, val)
			} else {
				os.Unsetenv(key)
			}
		}
	}()

	// Set custom values
	os.Setenv("SANDBOX_HOST", "custom.host")
	os.Setenv("SANDBOX_PORT", "2222")
	os.Setenv("SSH_KEY_PATH", "/custom/key/path")
	os.Setenv("WORKING_DIR", "/custom/working/dir")

	cfg := Load()

	if cfg.SandboxHost != "custom.host" {
		t.Errorf("expected SandboxHost 'custom.host', got %q", cfg.SandboxHost)
	}
	if cfg.SandboxPort != "2222" {
		t.Errorf("expected SandboxPort '2222', got %q", cfg.SandboxPort)
	}
	if cfg.SSHKeyPath != "/custom/key/path" {
		t.Errorf("expected SSHKeyPath '/custom/key/path', got %q", cfg.SSHKeyPath)
	}
	if cfg.WorkingDir != "/custom/working/dir" {
		t.Errorf("expected WorkingDir '/custom/working/dir', got %q", cfg.WorkingDir)
	}
}

func TestLoad_PartialOverride(t *testing.T) {
	// Save current values
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH", "WORKING_DIR"}
	saved := make(map[string]string)
	for _, key := range envVars {
		saved[key] = os.Getenv(key)
	}
	defer func() {
		for key, val := range saved {
			if val != "" {
				os.Setenv(key, val)
			} else {
				os.Unsetenv(key)
			}
		}
	}()

	// Set only some values
	os.Setenv("SANDBOX_HOST", "partial.host")
	os.Unsetenv("SANDBOX_PORT")
	os.Unsetenv("SSH_KEY_PATH")
	os.Unsetenv("WORKING_DIR")

	cfg := Load()

	if cfg.SandboxHost != "partial.host" {
		t.Errorf("expected SandboxHost 'partial.host', got %q", cfg.SandboxHost)
	}
	if cfg.SandboxPort != "22" {
		t.Errorf("expected default SandboxPort '22', got %q", cfg.SandboxPort)
	}
}

func TestGetEnv_WithValue(t *testing.T) {
	key := "TEST_CONFIG_VAR"
	saved := os.Getenv(key)
	defer func() {
		if saved != "" {
			os.Setenv(key, saved)
		} else {
			os.Unsetenv(key)
		}
	}()

	os.Setenv(key, "test_value")
	got := GetEnv(key, "default")

	if got != "test_value" {
		t.Errorf("expected 'test_value', got %q", got)
	}
}

func TestGetEnv_WithDefault(t *testing.T) {
	key := "TEST_CONFIG_VAR_UNSET"
	os.Unsetenv(key)

	got := GetEnv(key, "default_value")

	if got != "default_value" {
		t.Errorf("expected 'default_value', got %q", got)
	}
}

func TestGetEnv_EmptyValueUsesDefault(t *testing.T) {
	key := "TEST_CONFIG_VAR_EMPTY"
	saved := os.Getenv(key)
	defer func() {
		if saved != "" {
			os.Setenv(key, saved)
		} else {
			os.Unsetenv(key)
		}
	}()

	os.Setenv(key, "")
	got := GetEnv(key, "default_value")

	if got != "default_value" {
		t.Errorf("expected 'default_value' for empty env var, got %q", got)
	}
}
