package git

import (
	"errors"
	"testing"

	"detach.it/bridge/internal/executor"
)

// mockFileReader is a test double for the fileReader interface
type mockFileReader struct {
	Files map[string]string
	Err   error
}

func (m *mockFileReader) Read(path string) (string, error) {
	if m.Err != nil {
		return "", m.Err
	}
	if content, ok := m.Files[path]; ok {
		return content, nil
	}
	return "", errors.New("file not found")
}

func newMockFileReader() *mockFileReader {
	return &mockFileReader{
		Files: make(map[string]string),
	}
}

func TestNewService(t *testing.T) {
	mock := executor.NewMockExecutor()
	reader := newMockFileReader()
	svc := NewService(mock, reader, "/project")

	if svc == nil {
		t.Fatal("expected non-nil Service")
	}
	if svc.workingDir != "/project" {
		t.Errorf("expected workingDir '/project', got %q", svc.workingDir)
	}
}

func TestService_Status_Empty(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Unstaged) != 0 {
		t.Errorf("expected 0 unstaged, got %d", len(resp.Unstaged))
	}
	if len(resp.Staged) != 0 {
		t.Errorf("expected 0 staged, got %d", len(resp.Staged))
	}
}

func TestService_Status_UntrackedFile(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "?? newfile.txt\n", nil)
	reader := newMockFileReader()
	reader.Files["/project/newfile.txt"] = "new content\nline 2"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Unstaged) != 1 {
		t.Fatalf("expected 1 unstaged, got %d", len(resp.Unstaged))
	}
	if resp.Unstaged[0].Path != "newfile.txt" {
		t.Errorf("expected path 'newfile.txt', got %q", resp.Unstaged[0].Path)
	}
	if !resp.Unstaged[0].IsUntracked {
		t.Error("expected IsUntracked to be true")
	}
	if resp.Unstaged[0].Added != 2 {
		t.Errorf("expected 2 added lines, got %d", resp.Unstaged[0].Added)
	}
}

func TestService_Status_ModifiedUnstaged(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", " M modified.txt\n", nil)
	mock.AddResponse("cd /project && git diff 'modified.txt'", `diff --git a/modified.txt b/modified.txt
--- a/modified.txt
+++ b/modified.txt
@@ -1 +1,2 @@
 line1
+line2
`, nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Unstaged) != 1 {
		t.Fatalf("expected 1 unstaged, got %d", len(resp.Unstaged))
	}
	if resp.Unstaged[0].Path != "modified.txt" {
		t.Errorf("expected path 'modified.txt', got %q", resp.Unstaged[0].Path)
	}
	if resp.Unstaged[0].Added != 1 {
		t.Errorf("expected 1 added line, got %d", resp.Unstaged[0].Added)
	}
	if len(resp.Staged) != 0 {
		t.Errorf("expected 0 staged, got %d", len(resp.Staged))
	}
}

func TestService_Status_ModifiedStaged(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "M  staged.txt\n", nil)
	mock.AddResponse("cd /project && git diff --cached 'staged.txt'", `diff --git a/staged.txt b/staged.txt
--- a/staged.txt
+++ b/staged.txt
@@ -1,2 +1 @@
-old line
 kept line
`, nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Staged) != 1 {
		t.Fatalf("expected 1 staged, got %d", len(resp.Staged))
	}
	if resp.Staged[0].Path != "staged.txt" {
		t.Errorf("expected path 'staged.txt', got %q", resp.Staged[0].Path)
	}
	if resp.Staged[0].Removed != 1 {
		t.Errorf("expected 1 removed line, got %d", resp.Staged[0].Removed)
	}
	if len(resp.Unstaged) != 0 {
		t.Errorf("expected 0 unstaged, got %d", len(resp.Unstaged))
	}
}

func TestService_Status_AddedStaged(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "A  newfile.txt\n", nil)
	reader := newMockFileReader()
	reader.Files["/project/newfile.txt"] = "line 1\nline 2\nline 3"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Staged) != 1 {
		t.Fatalf("expected 1 staged, got %d", len(resp.Staged))
	}
	if resp.Staged[0].Path != "newfile.txt" {
		t.Errorf("expected path 'newfile.txt', got %q", resp.Staged[0].Path)
	}
	if !resp.Staged[0].IsUntracked {
		t.Error("expected IsUntracked to be true for staged addition")
	}
	if resp.Staged[0].Added != 3 {
		t.Errorf("expected 3 added lines, got %d", resp.Staged[0].Added)
	}
}

func TestService_Status_MixedStagedUnstaged(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "MM both.txt\n", nil)
	mock.AddResponse("cd /project && git diff 'both.txt'", `@@ -1 +1 @@
-old
+new
`, nil)
	mock.AddResponse("cd /project && git diff --cached 'both.txt'", `@@ -1 +1 @@
-original
+old
`, nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Unstaged) != 1 {
		t.Fatalf("expected 1 unstaged, got %d", len(resp.Unstaged))
	}
	if len(resp.Staged) != 1 {
		t.Fatalf("expected 1 staged, got %d", len(resp.Staged))
	}
	if resp.Unstaged[0].Path != "both.txt" {
		t.Errorf("expected unstaged path 'both.txt', got %q", resp.Unstaged[0].Path)
	}
	if resp.Staged[0].Path != "both.txt" {
		t.Errorf("expected staged path 'both.txt', got %q", resp.Staged[0].Path)
	}
}

func TestService_Status_MultipleFiles(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", `?? untracked.txt
 M modified.txt
M  staged.txt
`, nil)
	mock.AddResponse("cd /project && git diff 'modified.txt'", "+added\n", nil)
	mock.AddResponse("cd /project && git diff --cached 'staged.txt'", "-removed\n", nil)
	reader := newMockFileReader()
	reader.Files["/project/untracked.txt"] = "content"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.Status()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Unstaged) != 2 {
		t.Errorf("expected 2 unstaged, got %d", len(resp.Unstaged))
	}
	if len(resp.Staged) != 1 {
		t.Errorf("expected 1 staged, got %d", len(resp.Staged))
	}
}

func TestService_Status_Error(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git status --porcelain", "", errors.New("not a git repository"))
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	_, err := svc.Status()

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestService_getFileDiff_CountsAdditionsAndRemovals(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git diff 'file.txt'", `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
-removed1
-removed2
+added1
+added2
+added3
 line4
`, nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	diff, added, removed := svc.getFileDiff("file.txt", false)

	if added != 3 {
		t.Errorf("expected 3 added, got %d", added)
	}
	if removed != 2 {
		t.Errorf("expected 2 removed, got %d", removed)
	}
	if diff == "" {
		t.Error("expected non-empty diff")
	}
}

func TestService_getFileDiff_IgnoresHeaders(t *testing.T) {
	mock := executor.NewMockExecutor()
	// --- and +++ should not be counted as additions/removals
	mock.AddResponse("cd /project && git diff 'file.txt'", `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`, nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	_, added, removed := svc.getFileDiff("file.txt", false)

	if added != 1 {
		t.Errorf("expected 1 added (ignoring +++), got %d", added)
	}
	if removed != 1 {
		t.Errorf("expected 1 removed (ignoring ---), got %d", removed)
	}
}

func TestService_getFileDiff_StagedVsUnstaged(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git diff 'file.txt'", "unstaged diff", nil)
	mock.AddResponse("cd /project && git diff --cached 'file.txt'", "staged diff", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")

	// Unstaged diff
	diff, _, _ := svc.getFileDiff("file.txt", false)
	if diff != "unstaged diff" {
		t.Errorf("expected 'unstaged diff', got %q", diff)
	}

	// Staged diff
	diff, _, _ = svc.getFileDiff("file.txt", true)
	if diff != "staged diff" {
		t.Errorf("expected 'staged diff', got %q", diff)
	}
}

func TestService_Stage(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git add 'file.txt'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Stage("file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git add 'file.txt'") {
		t.Error("expected git add command to be called")
	}
}

func TestService_Unstage(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git reset HEAD 'file.txt'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Unstage("file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git reset HEAD 'file.txt'") {
		t.Error("expected git reset HEAD command to be called")
	}
}

func TestService_Discard_TrackedFile(t *testing.T) {
	mock := executor.NewMockExecutor()
	// File is tracked (ls-files succeeds)
	mock.AddResponse("cd /project && git ls-files --error-unmatch 'file.txt' 2>/dev/null", "file.txt", nil)
	mock.AddResponse("cd /project && git checkout -- 'file.txt'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Discard("file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git checkout -- 'file.txt'") {
		t.Error("expected git checkout command to be called for tracked file")
	}
}

func TestService_Discard_UntrackedFile(t *testing.T) {
	mock := executor.NewMockExecutor()
	// File is untracked (ls-files fails)
	mock.AddResponse("cd /project && git ls-files --error-unmatch 'file.txt' 2>/dev/null", "", errors.New("not tracked"))
	mock.AddResponse("cd /project && rm 'file.txt'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Discard("file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && rm 'file.txt'") {
		t.Error("expected rm command to be called for untracked file")
	}
	if mock.WasCalled("cd /project && git checkout -- 'file.txt'") {
		t.Error("git checkout should not be called for untracked file")
	}
}

func TestService_StageAll(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git add -A", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.StageAll()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git add -A") {
		t.Error("expected git add -A command to be called")
	}
}

func TestService_UnstageAll(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git reset HEAD", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.UnstageAll()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git reset HEAD") {
		t.Error("expected git reset HEAD command to be called")
	}
}

func TestService_Commit(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git commit -m 'test message'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Commit("test message")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git commit -m 'test message'") {
		t.Error("expected git commit command to be called")
	}
}

func TestService_Commit_EscapesSingleQuotes(t *testing.T) {
	mock := executor.NewMockExecutor()
	// Single quote escaping: ' becomes '\''
	mock.AddResponse("cd /project && git commit -m 'it'\\''s a test'", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Commit("it's a test")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git commit -m 'it'\\''s a test'") {
		t.Errorf("expected escaped commit command, got calls: %v", mock.CalledCommands)
	}
}

func TestService_Pull(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git pull", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Pull()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git pull") {
		t.Error("expected git pull command to be called")
	}
}

func TestService_Push(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git push", "", nil)
	reader := newMockFileReader()

	svc := NewService(mock, reader, "/project")
	err := svc.Push()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !mock.WasCalled("cd /project && git push") {
		t.Error("expected git push command to be called")
	}
}

func TestGenerateContextDiff_Normal(t *testing.T) {
	content := "line1\nline2\nline3"
	diff := GenerateContextDiff("file.txt", content)

	if diff == "" {
		t.Fatal("expected non-empty diff")
	}
	// Should contain unified diff headers
	if !contains(diff, "--- a/file.txt") {
		t.Error("expected --- a/file.txt header")
	}
	if !contains(diff, "+++ b/file.txt") {
		t.Error("expected +++ b/file.txt header")
	}
	// Should contain line count header
	if !contains(diff, "@@ -1,3 +1,3 @@") {
		t.Error("expected @@ -1,3 +1,3 @@ header")
	}
	// All lines should be context lines (space prefix)
	if !contains(diff, " line1") {
		t.Error("expected context line ' line1'")
	}
}

func TestGenerateContextDiff_EmptyFile(t *testing.T) {
	diff := GenerateContextDiff("file.txt", "")

	if diff != "" {
		t.Errorf("expected empty diff for empty file, got %q", diff)
	}
}

func TestGenerateContextDiff_SingleLine(t *testing.T) {
	content := "single line"
	diff := GenerateContextDiff("file.txt", content)

	if !contains(diff, "@@ -1,1 +1,1 @@") {
		t.Errorf("expected single line header, got %q", diff)
	}
	if !contains(diff, " single line") {
		t.Error("expected context line")
	}
}

func TestService_FileWithDiff_UntrackedFile(t *testing.T) {
	mock := executor.NewMockExecutor()
	// ls-files returns error for untracked files
	mock.AddResponse("cd /project && git ls-files --error-unmatch 'file.txt' 2>/dev/null", "", errors.New("not tracked"))
	reader := newMockFileReader()
	reader.Files["/project/file.txt"] = "file content"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.FileWithDiff("/project/file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.IsUntracked {
		t.Error("expected IsUntracked to be true")
	}
	if resp.Content != "file content" {
		t.Errorf("expected content 'file content', got %q", resp.Content)
	}
	if resp.Diff == "" {
		t.Error("expected non-empty diff for untracked file")
	}
}

func TestService_FileWithDiff_TrackedNoChanges(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git ls-files --error-unmatch 'file.txt' 2>/dev/null", "file.txt", nil)
	mock.AddResponse("cd /project && git diff -U99999 'file.txt'", "", nil)
	reader := newMockFileReader()
	reader.Files["/project/file.txt"] = "content"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.FileWithDiff("/project/file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.IsUntracked {
		t.Error("expected IsUntracked to be false")
	}
	if resp.HasDiff {
		t.Error("expected HasDiff to be false for unchanged file")
	}
}

func TestService_FileWithDiff_TrackedWithChanges(t *testing.T) {
	mock := executor.NewMockExecutor()
	mock.AddResponse("cd /project && git ls-files --error-unmatch 'file.txt' 2>/dev/null", "file.txt", nil)
	mock.AddResponse("cd /project && git diff -U99999 'file.txt'", `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`, nil)
	reader := newMockFileReader()
	reader.Files["/project/file.txt"] = "new"

	svc := NewService(mock, reader, "/project")
	resp, err := svc.FileWithDiff("/project/file.txt")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.IsUntracked {
		t.Error("expected IsUntracked to be false")
	}
	if !resp.HasDiff {
		t.Error("expected HasDiff to be true for changed file")
	}
	if resp.Diff == "" {
		t.Error("expected non-empty diff")
	}
}

func TestService_FileWithDiff_ReadError(t *testing.T) {
	mock := executor.NewMockExecutor()
	reader := newMockFileReader()
	reader.Err = errors.New("read error")

	svc := NewService(mock, reader, "/project")
	_, err := svc.FileWithDiff("/project/file.txt")

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// Helper function
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
