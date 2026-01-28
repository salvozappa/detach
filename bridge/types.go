package main

// Message types

type ResizeMessage struct {
	Type     string `json:"type"`
	Terminal string `json:"terminal"` // "llm" or "terminal"
	Rows     int    `json:"rows"`
	Cols     int    `json:"cols"`
}

type SessionMessage struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type TerminalDataMessage struct {
	Type     string `json:"type"`     // "terminal_data"
	Terminal string `json:"terminal"` // "llm" or "terminal"
	Data     string `json:"data"`     // base64 encoded
}

// File operation messages
type FileRequest struct {
	Type string `json:"type"` // "list_files" or "read_file"
	Path string `json:"path"`
}

type FileInfo struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size"`
	IsIgnored bool   `json:"is_ignored"`
}

type FileListResponse struct {
	Type  string     `json:"type"` // "file_list"
	Path  string     `json:"path"`
	Files []FileInfo `json:"files"`
	Error string     `json:"error,omitempty"`
}

type FileContentResponse struct {
	Type    string `json:"type"` // "file_content"
	Path    string `json:"path"`
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
}

// File with diff response for Code panel
type FileWithDiffResponse struct {
	Type        string `json:"type"` // "file_with_diff"
	Path        string `json:"path"`
	Content     string `json:"content"`     // Full file content (for fallback)
	Diff        string `json:"diff"`        // Raw unified diff from git diff
	HasDiff     bool   `json:"hasDiff"`     // True if file has unstaged changes
	IsUntracked bool   `json:"isUntracked"` // True if file is not tracked
	Error       string `json:"error,omitempty"`
}

// Git operation messages
type GitFileChange struct {
	Path        string `json:"path"`
	Diff        string `json:"diff"`
	Added       int    `json:"added"`
	Removed     int    `json:"removed"`
	IsUntracked bool   `json:"isUntracked"`
}

type GitStatusResponse struct {
	Type     string          `json:"type"` // "git_status"
	Unstaged []GitFileChange `json:"unstaged"`
	Staged   []GitFileChange `json:"staged"`
}

type GitActionRequest struct {
	Type string `json:"type"` // "git_stage", "git_unstage", "git_discard"
	File string `json:"file"`
}

type GitCommitRequest struct {
	Type    string `json:"type"`    // "git_commit"
	Message string `json:"message"`
}

type GitPullRequest struct {
	Type string `json:"type"` // "git_pull"
}

type GitPushRequest struct {
	Type string `json:"type"` // "git_push"
}

type GitActionResponse struct {
	Type  string `json:"type"` // "git_stage_success", etc or "git_error"
	Error string `json:"error,omitempty"`
}

// WebSocket keepalive message (sent to client so JS can track connection health)
type PongMessage struct {
	Type string `json:"type"` // "pong"
}

// Web Push subscription (received from PWA via WebSocket)
type WebPushKeys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type WebPushSubscription struct {
	Endpoint string      `json:"endpoint"`
	Keys     WebPushKeys `json:"keys"`
}

type WebPushMessage struct {
	Type         string              `json:"type"` // "register_web_push"
	Subscription WebPushSubscription `json:"subscription"`
}
