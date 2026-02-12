package config

import (
	"os"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Save and clear relevant env vars
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH"}
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
	if cfg.WorkingDir != "~/project" {
		t.Errorf("expected hardcoded WorkingDir '~/project', got %q", cfg.WorkingDir)
	}
}

func TestLoad_OverrideFromEnv(t *testing.T) {
	// Save current values
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH"}
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
	if cfg.WorkingDir != "~/project" {
		t.Errorf("expected hardcoded WorkingDir '~/project', got %q", cfg.WorkingDir)
	}
}

func TestLoad_PartialOverride(t *testing.T) {
	// Save current values
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH"}
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

func TestParseClaudeArgs_MultipleArgs(t *testing.T) {
	args := parseClaudeArgs("--arg1 --arg2 --arg3")
	if len(args) != 3 {
		t.Errorf("expected 3 args, got %d", len(args))
	}
	if args[0] != "--arg1" || args[1] != "--arg2" || args[2] != "--arg3" {
		t.Errorf("unexpected args: %v", args)
	}
}

func TestParseClaudeArgs_SingleArg(t *testing.T) {
	args := parseClaudeArgs("--dangerously-skip-permissions")
	if len(args) != 1 || args[0] != "--dangerously-skip-permissions" {
		t.Errorf("expected ['--dangerously-skip-permissions'], got %v", args)
	}
}

func TestParseClaudeArgs_Empty(t *testing.T) {
	args := parseClaudeArgs("")
	if len(args) != 0 {
		t.Errorf("expected empty slice, got %v", args)
	}
}

func TestParseClaudeArgs_Whitespace(t *testing.T) {
	args := parseClaudeArgs("  --arg1   --arg2  ")
	if len(args) != 2 || args[0] != "--arg1" || args[1] != "--arg2" {
		t.Errorf("expected ['--arg1', '--arg2'], got %v", args)
	}
}

func TestBuildClaudeArgsString(t *testing.T) {
	cfg := &Config{
		ClaudeArgs: []string{"--arg1", "--arg2", "--arg3"},
	}

	got := cfg.BuildClaudeArgsString()
	expected := "--arg1 --arg2 --arg3"

	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestBuildClaudeArgsString_SingleArg(t *testing.T) {
	cfg := &Config{
		ClaudeArgs: []string{"--dangerously-skip-permissions"},
	}

	got := cfg.BuildClaudeArgsString()
	expected := "--dangerously-skip-permissions"

	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestBuildClaudeArgsString_Empty(t *testing.T) {
	cfg := &Config{
		ClaudeArgs: []string{},
	}

	got := cfg.BuildClaudeArgsString()
	expected := ""

	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestLoad_DefaultClaudeArgs(t *testing.T) {
	// Save and clear relevant env vars
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH", "CLAUDE_ARGS"}
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

	if len(cfg.ClaudeArgs) != 1 || cfg.ClaudeArgs[0] != "--dangerously-skip-permissions" {
		t.Errorf("expected default ClaudeArgs ['--dangerously-skip-permissions'], got %v", cfg.ClaudeArgs)
	}
}

func TestLoad_WithClaudeArgsEnv(t *testing.T) {
	// Save and set env vars
	envVars := []string{"SANDBOX_HOST", "SANDBOX_PORT", "SSH_KEY_PATH", "CLAUDE_ARGS"}
	saved := make(map[string]string)
	for _, key := range envVars {
		saved[key] = os.Getenv(key)
		os.Unsetenv(key)
	}
	os.Setenv("CLAUDE_ARGS", "--custom-arg --another-arg")
	defer func() {
		for key, val := range saved {
			if val != "" {
				os.Setenv(key, val)
			} else {
				os.Unsetenv(key)
			}
		}
	}()

	cfg := Load()

	if cfg.WorkingDir != "~/project" {
		t.Errorf("expected hardcoded WorkingDir '~/project', got %q", cfg.WorkingDir)
	}
	if len(cfg.ClaudeArgs) != 2 || cfg.ClaudeArgs[0] != "--custom-arg" || cfg.ClaudeArgs[1] != "--another-arg" {
		t.Errorf("expected ClaudeArgs ['--custom-arg', '--another-arg'], got %v", cfg.ClaudeArgs)
	}
}

func TestLoad_SkipAuthentication_Default(t *testing.T) {
	// Save and clear env vars
	saved := os.Getenv("SKIP_AUTHENTICATION")
	os.Unsetenv("SKIP_AUTHENTICATION")
	defer func() {
		if saved != "" {
			os.Setenv("SKIP_AUTHENTICATION", saved)
		}
	}()

	cfg := Load()

	if cfg.SkipAuthentication {
		t.Error("expected SkipAuthentication to be false by default")
	}
}

func TestLoad_SkipAuthentication_Enabled(t *testing.T) {
	// Save and set env var
	saved := os.Getenv("SKIP_AUTHENTICATION")
	os.Setenv("SKIP_AUTHENTICATION", "1")
	defer func() {
		if saved != "" {
			os.Setenv("SKIP_AUTHENTICATION", saved)
		} else {
			os.Unsetenv("SKIP_AUTHENTICATION")
		}
	}()

	cfg := Load()

	if !cfg.SkipAuthentication {
		t.Error("expected SkipAuthentication to be true when SKIP_AUTHENTICATION is set")
	}
}

func TestLoad_SkipAuthentication_TruthyValues(t *testing.T) {
	// Test that truthy values enable skip authentication
	testCases := []string{"1", "true", "True", "TRUE", "yes", "Yes", "YES"}

	for _, value := range testCases {
		t.Run(value, func(t *testing.T) {
			saved := os.Getenv("SKIP_AUTHENTICATION")
			os.Setenv("SKIP_AUTHENTICATION", value)
			defer func() {
				if saved != "" {
					os.Setenv("SKIP_AUTHENTICATION", saved)
				} else {
					os.Unsetenv("SKIP_AUTHENTICATION")
				}
			}()

			cfg := Load()

			if !cfg.SkipAuthentication {
				t.Errorf("expected SkipAuthentication to be true when SKIP_AUTHENTICATION=%q", value)
			}
		})
	}
}

func TestLoad_SkipAuthentication_FalsyValues(t *testing.T) {
	// Test that falsy values do NOT enable skip authentication
	testCases := []string{"0", "false", "False", "FALSE", "no", "No", "NO", "invalid", "anything", ""}

	for _, value := range testCases {
		t.Run(value, func(t *testing.T) {
			saved := os.Getenv("SKIP_AUTHENTICATION")
			if value == "" {
				os.Unsetenv("SKIP_AUTHENTICATION")
			} else {
				os.Setenv("SKIP_AUTHENTICATION", value)
			}
			defer func() {
				if saved != "" {
					os.Setenv("SKIP_AUTHENTICATION", saved)
				} else {
					os.Unsetenv("SKIP_AUTHENTICATION")
				}
			}()

			cfg := Load()

			if cfg.SkipAuthentication {
				t.Errorf("expected SkipAuthentication to be false when SKIP_AUTHENTICATION=%q", value)
			}
		})
	}
}

func TestParseBool_TruthyValues(t *testing.T) {
	testCases := []string{"1", "true", "True", "TRUE", "yes", "Yes", "YES", " 1 ", " true ", " YES "}

	for _, value := range testCases {
		t.Run(value, func(t *testing.T) {
			result := parseBool(value)
			if !result {
				t.Errorf("expected parseBool(%q) to return true", value)
			}
		})
	}
}

func TestParseBool_FalsyValues(t *testing.T) {
	testCases := []string{"0", "false", "False", "FALSE", "no", "No", "NO", "", "invalid", "2", "anything"}

	for _, value := range testCases {
		t.Run(value, func(t *testing.T) {
			result := parseBool(value)
			if result {
				t.Errorf("expected parseBool(%q) to return false", value)
			}
		})
	}
}
