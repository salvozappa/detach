package main

import (
	"os"
	"testing"
)

func TestGetEnv_ReturnsValue(t *testing.T) {
	key := "TEST_GETENV_VALUE"
	os.Setenv(key, "myvalue")
	defer os.Unsetenv(key)

	result := getEnv(key, "default")
	if result != "myvalue" {
		t.Errorf("expected 'myvalue', got '%s'", result)
	}
}

func TestGetEnv_ReturnsDefault(t *testing.T) {
	key := "TEST_GETENV_NOTSET"
	os.Unsetenv(key) // Ensure it's not set

	result := getEnv(key, "defaultvalue")
	if result != "defaultvalue" {
		t.Errorf("expected 'defaultvalue', got '%s'", result)
	}
}

func TestGetEnv_EmptyValue(t *testing.T) {
	key := "TEST_GETENV_EMPTY"
	os.Setenv(key, "")
	defer os.Unsetenv(key)

	// Empty string is treated as unset, returns default
	result := getEnv(key, "default")
	if result != "default" {
		t.Errorf("expected 'default' for empty env var, got '%s'", result)
	}
}

func TestGetEnv_WhitespaceValue(t *testing.T) {
	key := "TEST_GETENV_WHITESPACE"
	os.Setenv(key, "   ")
	defer os.Unsetenv(key)

	// Whitespace is not empty, should return the whitespace
	result := getEnv(key, "default")
	if result != "   " {
		t.Errorf("expected '   ', got '%s'", result)
	}
}
