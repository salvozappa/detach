package wshandler

import (
	"encoding/base64"
	"errors"
	"testing"

	"detach.it/bridge/internal/types"
)

// Mock implementations

type mockResponder struct {
	Responses []interface{}
	Err       error
}

func (m *mockResponder) WriteJSON(v interface{}) error {
	if m.Err != nil {
		return m.Err
	}
	m.Responses = append(m.Responses, v)
	return nil
}

type mockGitService struct {
	StatusResp      *types.GitStatusResponse
	StatusErr       error
	StageErr        error
	UnstageErr      error
	DiscardErr      error
	StageAllErr     error
	UnstageAllErr   error
	CommitErr       error
	PullErr         error
	PushErr         error
	FileWithDiffResp *types.FileWithDiffResponse
	FileWithDiffErr  error

	StagedFiles    []string
	UnstagedFiles  []string
	DiscardedFiles []string
	CommitMessages []string
}

func (m *mockGitService) Status() (*types.GitStatusResponse, error) {
	return m.StatusResp, m.StatusErr
}
func (m *mockGitService) Stage(file string) error {
	m.StagedFiles = append(m.StagedFiles, file)
	return m.StageErr
}
func (m *mockGitService) Unstage(file string) error {
	m.UnstagedFiles = append(m.UnstagedFiles, file)
	return m.UnstageErr
}
func (m *mockGitService) StageAll() error   { return m.StageAllErr }
func (m *mockGitService) UnstageAll() error { return m.UnstageAllErr }
func (m *mockGitService) Discard(file string) error {
	m.DiscardedFiles = append(m.DiscardedFiles, file)
	return m.DiscardErr
}
func (m *mockGitService) Commit(message string) error {
	m.CommitMessages = append(m.CommitMessages, message)
	return m.CommitErr
}
func (m *mockGitService) Pull() error { return m.PullErr }
func (m *mockGitService) Push() error { return m.PushErr }
func (m *mockGitService) FileWithDiff(path string) (*types.FileWithDiffResponse, error) {
	return m.FileWithDiffResp, m.FileWithDiffErr
}

type mockFileService struct {
	ListResp []types.FileInfo
	ListErr  error
	ReadResp string
	ReadErr  error
}

func (m *mockFileService) List(path string) ([]types.FileInfo, error) {
	return m.ListResp, m.ListErr
}
func (m *mockFileService) Read(path string) (string, error) {
	return m.ReadResp, m.ReadErr
}

type mockNotifyService struct {
	Registrations []struct {
		SessionID    string
		Subscription types.WebPushSubscription
	}
}

func (m *mockNotifyService) RegisterSubscription(sessionID string, sub types.WebPushSubscription) {
	m.Registrations = append(m.Registrations, struct {
		SessionID    string
		Subscription types.WebPushSubscription
	}{sessionID, sub})
}

type mockWriter struct {
	Written []byte
	Err     error
}

func (m *mockWriter) Write(p []byte) (int, error) {
	if m.Err != nil {
		return 0, m.Err
	}
	m.Written = append(m.Written, p...)
	return len(p), nil
}

type mockResizer struct {
	Calls []struct {
		Terminal string
		Rows     int
		Cols     int
	}
	Err error
}

func (m *mockResizer) Resize(terminal string, rows, cols int) error {
	m.Calls = append(m.Calls, struct {
		Terminal string
		Rows     int
		Cols     int
	}{terminal, rows, cols})
	return m.Err
}

// Helper to create test deps
func newTestDeps() *Deps {
	return &Deps{
		SessionID:  "test-session",
		Done:       make(chan struct{}),
		Git:        &mockGitService{},
		Files:      &mockFileService{},
		Notify:     &mockNotifyService{},
		Responder:  &mockResponder{},
		Resizer:    &mockResizer{},
		AgentStdin:   &mockWriter{},
		ShellStdin: &mockWriter{},
	}
}

// Terminal Data Tests

func TestHandleTerminalData_AgentTerminal(t *testing.T) {
	deps := newTestDeps()
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	payload := []byte(`{"type":"terminal_data","terminal":"agent","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	if !result {
		t.Error("expected true return value")
	}
	agentWriter := deps.AgentStdin.(*mockWriter)
	if string(agentWriter.Written) != "hello" {
		t.Errorf("expected 'hello' written to agent, got %q", agentWriter.Written)
	}
	shellWriter := deps.ShellStdin.(*mockWriter)
	if len(shellWriter.Written) != 0 {
		t.Error("expected nothing written to shell stdin")
	}
}

func TestHandleTerminalData_ShellTerminal(t *testing.T) {
	deps := newTestDeps()
	data := base64.StdEncoding.EncodeToString([]byte("ls -la"))
	payload := []byte(`{"type":"terminal_data","terminal":"terminal","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	if !result {
		t.Error("expected true return value")
	}
	shellWriter := deps.ShellStdin.(*mockWriter)
	if string(shellWriter.Written) != "ls -la" {
		t.Errorf("expected 'ls -la' written to shell, got %q", shellWriter.Written)
	}
	agentWriter := deps.AgentStdin.(*mockWriter)
	if len(agentWriter.Written) != 0 {
		t.Error("expected nothing written to agent stdin")
	}
}

func TestHandleTerminalData_UnknownTerminalRoutesToAgent(t *testing.T) {
	deps := newTestDeps()
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	// Any terminal value other than "terminal" should route to AgentStdin
	payload := []byte(`{"type":"terminal_data","terminal":"unknown","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	if !result {
		t.Error("expected true return value")
	}
	agentWriter := deps.AgentStdin.(*mockWriter)
	if string(agentWriter.Written) != "hello" {
		t.Errorf("expected 'hello' written to agent, got %q", agentWriter.Written)
	}
	shellWriter := deps.ShellStdin.(*mockWriter)
	if len(shellWriter.Written) != 0 {
		t.Error("expected nothing written to shell stdin")
	}
}

func TestHandleTerminalData_EmptyTerminalRoutesToAgent(t *testing.T) {
	deps := newTestDeps()
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	// Missing terminal field should default to agent
	payload := []byte(`{"type":"terminal_data","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	if !result {
		t.Error("expected true return value")
	}
	agentWriter := deps.AgentStdin.(*mockWriter)
	if string(agentWriter.Written) != "hello" {
		t.Errorf("expected 'hello' written to agent, got %q", agentWriter.Written)
	}
}

func TestHandleTerminalData_OldLLMValueRoutesToAgent(t *testing.T) {
	// Guard against accidentally reintroducing "llm" as a special case.
	// The old wire value "llm" is no longer used; it should fall through
	// to the agent branch (the else clause) just like any non-"terminal" value.
	deps := newTestDeps()
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	payload := []byte(`{"type":"terminal_data","terminal":"llm","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	if !result {
		t.Error("expected true return value")
	}
	agentWriter := deps.AgentStdin.(*mockWriter)
	if string(agentWriter.Written) != "hello" {
		t.Errorf("expected 'hello' written to agent, got %q", agentWriter.Written)
	}
}

func TestHandleTerminalData_InvalidBase64(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"terminal_data","terminal":"agent","data":"not-valid-base64!!!"}`)

	result := HandleTerminalData(deps, payload)

	// Should return true (continue processing) even on decode error
	if !result {
		t.Error("expected true return value on decode error")
	}
}

func TestHandleTerminalData_WriteError(t *testing.T) {
	deps := newTestDeps()
	agentWriter := &mockWriter{Err: errors.New("write error")}
	deps.AgentStdin = agentWriter
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	payload := []byte(`{"type":"terminal_data","terminal":"agent","data":"` + data + `"}`)

	result := HandleTerminalData(deps, payload)

	// Should return false on write error
	if result {
		t.Error("expected false return value on write error")
	}
}

func TestHandleTerminalData_InvalidJSON(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{invalid json}`)

	result := HandleTerminalData(deps, payload)

	// Should return true (continue processing) on parse error
	if !result {
		t.Error("expected true return value on parse error")
	}
}

// Resize Tests

func TestHandleResize_Success(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"resize","terminal":"agent","rows":24,"cols":80}`)

	HandleResize(deps, payload)

	resizer := deps.Resizer.(*mockResizer)
	if len(resizer.Calls) != 1 {
		t.Fatalf("expected 1 resize call, got %d", len(resizer.Calls))
	}
	if resizer.Calls[0].Terminal != "agent" {
		t.Errorf("expected terminal 'agent', got %q", resizer.Calls[0].Terminal)
	}
	if resizer.Calls[0].Rows != 24 {
		t.Errorf("expected rows 24, got %d", resizer.Calls[0].Rows)
	}
	if resizer.Calls[0].Cols != 80 {
		t.Errorf("expected cols 80, got %d", resizer.Calls[0].Cols)
	}
}

func TestHandleResize_ShellTerminal(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"resize","terminal":"terminal","rows":30,"cols":120}`)

	HandleResize(deps, payload)

	resizer := deps.Resizer.(*mockResizer)
	if len(resizer.Calls) != 1 {
		t.Fatalf("expected 1 resize call, got %d", len(resizer.Calls))
	}
	if resizer.Calls[0].Terminal != "terminal" {
		t.Errorf("expected terminal 'terminal', got %q", resizer.Calls[0].Terminal)
	}
	if resizer.Calls[0].Rows != 30 {
		t.Errorf("expected rows 30, got %d", resizer.Calls[0].Rows)
	}
	if resizer.Calls[0].Cols != 120 {
		t.Errorf("expected cols 120, got %d", resizer.Calls[0].Cols)
	}
}

func TestHandleResize_InvalidPayload(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{invalid}`)

	// Should not panic on invalid payload
	HandleResize(deps, payload)

	resizer := deps.Resizer.(*mockResizer)
	if len(resizer.Calls) != 0 {
		t.Error("expected no resize calls on invalid payload")
	}
}

// File Operation Tests

func TestHandleListFiles_Success(t *testing.T) {
	deps := newTestDeps()
	filesSvc := &mockFileService{
		ListResp: []types.FileInfo{
			{Name: "file.txt", IsDir: false, Size: 100},
			{Name: "dir", IsDir: true, Size: 0},
		},
	}
	deps.Files = filesSvc
	payload := []byte(`{"type":"list_files","path":"/project"}`)

	HandleListFiles(deps, payload)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp, ok := responder.Responses[0].(types.FileListResponse)
	if !ok {
		t.Fatalf("expected FileListResponse type, got %T", responder.Responses[0])
	}
	if resp.Type != "file_list" {
		t.Errorf("expected type 'file_list', got %q", resp.Type)
	}
	if len(resp.Files) != 2 {
		t.Errorf("expected 2 files, got %d", len(resp.Files))
	}
	if resp.Error != "" {
		t.Errorf("expected no error, got %q", resp.Error)
	}
}

func TestHandleListFiles_Error(t *testing.T) {
	deps := newTestDeps()
	filesSvc := &mockFileService{
		ListErr: errors.New("directory not found"),
	}
	deps.Files = filesSvc
	payload := []byte(`{"type":"list_files","path":"/nonexistent"}`)

	HandleListFiles(deps, payload)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(types.FileListResponse)
	if resp.Error == "" {
		t.Error("expected error in response")
	}
}

func TestHandleReadFile_Success(t *testing.T) {
	deps := newTestDeps()
	filesSvc := &mockFileService{
		ReadResp: "file content here",
	}
	deps.Files = filesSvc
	payload := []byte(`{"type":"read_file","path":"/project/file.txt"}`)

	HandleReadFile(deps, payload)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(types.FileContentResponse)
	if resp.Type != "file_content" {
		t.Errorf("expected type 'file_content', got %q", resp.Type)
	}
	if resp.Content != "file content here" {
		t.Errorf("expected content 'file content here', got %q", resp.Content)
	}
}

func TestHandleReadFileWithDiff_Success(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{
		FileWithDiffResp: &types.FileWithDiffResponse{
			Type:    "file_with_diff",
			Path:    "/project/file.txt",
			Content: "content",
			Diff:    "diff output",
			HasDiff: true,
		},
	}
	deps.Git = gitSvc
	payload := []byte(`{"type":"read_file_with_diff","path":"/project/file.txt"}`)

	HandleReadFileWithDiff(deps, payload)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(*types.FileWithDiffResponse)
	if resp.Type != "file_with_diff" {
		t.Errorf("expected type 'file_with_diff', got %q", resp.Type)
	}
	if !resp.HasDiff {
		t.Error("expected HasDiff to be true")
	}
}

func TestHandleReadFileWithDiff_Error(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{
		FileWithDiffErr: errors.New("file not found"),
	}
	deps.Git = gitSvc
	payload := []byte(`{"type":"read_file_with_diff","path":"/nonexistent"}`)

	HandleReadFileWithDiff(deps, payload)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(types.FileWithDiffResponse)
	if resp.Error == "" {
		t.Error("expected error in response")
	}
}

// Git Status Tests

func TestHandleGitStatus_Success(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{
		StatusResp: &types.GitStatusResponse{
			Type: "git_status",
			Unstaged: []types.GitFileChange{
				{Path: "file.txt", Added: 1, Removed: 0},
			},
			Staged: []types.GitFileChange{},
		},
	}
	deps.Git = gitSvc

	HandleGitStatus(deps)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(*types.GitStatusResponse)
	if resp.Type != "git_status" {
		t.Errorf("expected type 'git_status', got %q", resp.Type)
	}
	if len(resp.Unstaged) != 1 {
		t.Errorf("expected 1 unstaged file, got %d", len(resp.Unstaged))
	}
}

func TestHandleGitStatus_Error(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{
		StatusErr: errors.New("not a git repo"),
	}
	deps.Git = gitSvc

	HandleGitStatus(deps)

	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatalf("expected 1 response, got %d", len(responder.Responses))
	}
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_error" {
		t.Errorf("expected type 'git_error', got %q", resp.Type)
	}
	if resp.Error == "" {
		t.Error("expected error message")
	}
}

// Git File Action Tests

func TestHandleGitFileAction_Stage_Success(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_stage","file":"file.txt"}`)

	HandleGitFileAction(deps, payload, "git_stage", gitSvc.Stage)

	if len(gitSvc.StagedFiles) != 1 || gitSvc.StagedFiles[0] != "file.txt" {
		t.Errorf("expected file.txt to be staged, got %v", gitSvc.StagedFiles)
	}
	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_stage_success" {
		t.Errorf("expected type 'git_stage_success', got %q", resp.Type)
	}
}

func TestHandleGitFileAction_Stage_Error(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{StageErr: errors.New("stage error")}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_stage","file":"file.txt"}`)

	HandleGitFileAction(deps, payload, "git_stage", gitSvc.Stage)

	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_error" {
		t.Errorf("expected type 'git_error', got %q", resp.Type)
	}
}

func TestHandleGitFileAction_Unstage(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_unstage","file":"file.txt"}`)

	HandleGitFileAction(deps, payload, "git_unstage", gitSvc.Unstage)

	if len(gitSvc.UnstagedFiles) != 1 || gitSvc.UnstagedFiles[0] != "file.txt" {
		t.Errorf("expected file.txt to be unstaged, got %v", gitSvc.UnstagedFiles)
	}
}

func TestHandleGitFileAction_Discard(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_discard","file":"file.txt"}`)

	HandleGitFileAction(deps, payload, "git_discard", gitSvc.Discard)

	if len(gitSvc.DiscardedFiles) != 1 || gitSvc.DiscardedFiles[0] != "file.txt" {
		t.Errorf("expected file.txt to be discarded, got %v", gitSvc.DiscardedFiles)
	}
}

// Git Bulk Action Tests

func TestHandleGitBulkAction_StageAll(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{}
	deps.Git = gitSvc

	HandleGitBulkAction(deps, "git_stage_all", gitSvc.StageAll)

	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_stage_all_success" {
		t.Errorf("expected type 'git_stage_all_success', got %q", resp.Type)
	}
}

func TestHandleGitBulkAction_Error(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{StageAllErr: errors.New("error")}
	deps.Git = gitSvc

	HandleGitBulkAction(deps, "git_stage_all", gitSvc.StageAll)

	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_error" {
		t.Errorf("expected type 'git_error', got %q", resp.Type)
	}
}

// Git Commit Tests

func TestHandleGitCommit_Success(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_commit","message":"test commit"}`)

	HandleGitCommit(deps, payload)

	if len(gitSvc.CommitMessages) != 1 || gitSvc.CommitMessages[0] != "test commit" {
		t.Errorf("expected commit message 'test commit', got %v", gitSvc.CommitMessages)
	}
	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_commit_success" {
		t.Errorf("expected type 'git_commit_success', got %q", resp.Type)
	}
}

func TestHandleGitCommit_Error(t *testing.T) {
	deps := newTestDeps()
	gitSvc := &mockGitService{CommitErr: errors.New("nothing to commit")}
	deps.Git = gitSvc
	payload := []byte(`{"type":"git_commit","message":"test"}`)

	HandleGitCommit(deps, payload)

	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(types.GitActionResponse)
	if resp.Type != "git_error" {
		t.Errorf("expected type 'git_error', got %q", resp.Type)
	}
}

// Web Push Tests

func TestHandleRegisterWebPush_Success(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"register_web_push","subscription":{"endpoint":"https://push.example.com/abc","keys":{"p256dh":"key1","auth":"key2"}}}`)

	HandleRegisterWebPush(deps, payload)

	notifySvc := deps.Notify.(*mockNotifyService)
	if len(notifySvc.Registrations) != 1 {
		t.Fatalf("expected 1 registration, got %d", len(notifySvc.Registrations))
	}
	if notifySvc.Registrations[0].Subscription.Endpoint != "https://push.example.com/abc" {
		t.Errorf("unexpected endpoint: %s", notifySvc.Registrations[0].Subscription.Endpoint)
	}
	responder := deps.Responder.(*mockResponder)
	if len(responder.Responses) != 1 {
		t.Fatal("expected response")
	}
}

func TestHandleRegisterWebPush_EmptyEndpoint(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"register_web_push","subscription":{"endpoint":"","keys":{}}}`)

	HandleRegisterWebPush(deps, payload)

	notifySvc := deps.Notify.(*mockNotifyService)
	if len(notifySvc.Registrations) != 0 {
		t.Error("expected no registrations for empty endpoint")
	}
	responder := deps.Responder.(*mockResponder)
	resp := responder.Responses[0].(map[string]string)
	if resp["status"] != "error" {
		t.Errorf("expected status 'error', got %q", resp["status"])
	}
}

// Debug Log Tests

func TestHandleDebugLog_WithData(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"debug_log","category":"WS","message":"test message","data":{"key":"value"}}`)

	// Should not panic
	HandleDebugLog(deps, payload)
}

func TestHandleDebugLog_NoData(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{"type":"debug_log","category":"WS","message":"test message"}`)

	// Should not panic
	HandleDebugLog(deps, payload)
}

func TestHandleDebugLog_InvalidJSON(t *testing.T) {
	deps := newTestDeps()
	payload := []byte(`{invalid}`)

	// Should not panic on invalid JSON
	HandleDebugLog(deps, payload)
}
