package main

import (
	"strings"
	"testing"
)

func TestGenerateContextDiff_EmptyContent(t *testing.T) {
	result := generateContextDiff("test.txt", "")
	if result != "" {
		t.Errorf("expected empty string for empty content, got '%s'", result)
	}
}

func TestGenerateContextDiff_SingleLine(t *testing.T) {
	result := generateContextDiff("test.txt", "hello world")

	// Check header
	if !strings.HasPrefix(result, "--- a/test.txt\n") {
		t.Error("missing or incorrect '--- a/' header")
	}
	if !strings.Contains(result, "+++ b/test.txt\n") {
		t.Error("missing or incorrect '+++ b/' header")
	}
	if !strings.Contains(result, "@@ -1,1 +1,1 @@\n") {
		t.Error("missing or incorrect @@ hunk header")
	}
	// Check content line (space prefix for context)
	if !strings.Contains(result, " hello world\n") {
		t.Errorf("missing context line, got: %s", result)
	}
}

func TestGenerateContextDiff_MultipleLines(t *testing.T) {
	content := "line1\nline2\nline3"
	result := generateContextDiff("file.go", content)

	// Check hunk header shows 3 lines
	if !strings.Contains(result, "@@ -1,3 +1,3 @@\n") {
		t.Errorf("expected @@ -1,3 +1,3 @@ hunk header, got: %s", result)
	}

	// Check all lines have space prefix
	if !strings.Contains(result, " line1\n") {
		t.Error("missing ' line1'")
	}
	if !strings.Contains(result, " line2\n") {
		t.Error("missing ' line2'")
	}
	if !strings.Contains(result, " line3\n") {
		t.Error("missing ' line3'")
	}
}

func TestGenerateContextDiff_HeaderFormat(t *testing.T) {
	result := generateContextDiff("src/main.go", "package main")

	lines := strings.Split(result, "\n")
	if len(lines) < 4 {
		t.Fatalf("expected at least 4 lines, got %d", len(lines))
	}

	if lines[0] != "--- a/src/main.go" {
		t.Errorf("expected '--- a/src/main.go', got '%s'", lines[0])
	}
	if lines[1] != "+++ b/src/main.go" {
		t.Errorf("expected '+++ b/src/main.go', got '%s'", lines[1])
	}
	if lines[2] != "@@ -1,1 +1,1 @@" {
		t.Errorf("expected '@@ -1,1 +1,1 @@', got '%s'", lines[2])
	}
	if lines[3] != " package main" {
		t.Errorf("expected ' package main', got '%s'", lines[3])
	}
}

func TestGenerateContextDiff_ContentWithTrailingNewline(t *testing.T) {
	// Content with trailing newline creates an extra empty line
	content := "line1\nline2\n"
	result := generateContextDiff("test.txt", content)

	// Split on \n results in 3 elements: "line1", "line2", ""
	if !strings.Contains(result, "@@ -1,3 +1,3 @@") {
		t.Errorf("expected 3 lines in hunk header, got: %s", result)
	}
}

func TestGenerateContextDiff_SpecialCharacters(t *testing.T) {
	content := "func main() {\n\treturn\n}"
	result := generateContextDiff("main.go", content)

	if !strings.Contains(result, " func main() {") {
		t.Error("missing first line with special characters")
	}
	if !strings.Contains(result, " \treturn") {
		t.Error("missing tab character in content")
	}
	if !strings.Contains(result, " }") {
		t.Error("missing closing brace")
	}
}
