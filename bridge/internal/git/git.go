package git

import (
	"fmt"
	"strings"

	"detach.it/bridge/internal/executor"
	"detach.it/bridge/internal/types"
)

// FileReader reads file content (used for untracked files in status)
type FileReader interface {
	Read(path string) (string, error)
}

// Service handles git operations
type Service struct {
	exec       executor.Executor
	files      FileReader
	workingDir string
}

// NewService creates a new git service
func NewService(exec executor.Executor, files FileReader, workingDir string) *Service {
	return &Service{
		exec:       exec,
		files:      files,
		workingDir: workingDir,
	}
}

// Status returns the current git status
func (s *Service) Status() (*types.GitStatusResponse, error) {
	// Execute git status with porcelain format
	cmd := fmt.Sprintf("cd %s && git status --porcelain", s.workingDir)
	output, err := s.exec.Run(cmd)
	if err != nil {
		return nil, err
	}

	resp := &types.GitStatusResponse{
		Type:     "git_status",
		Unstaged: []types.GitFileChange{},
		Staged:   []types.GitFileChange{},
	}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		// Porcelain format: XY filename
		// X = staged status, Y = unstaged status
		if len(line) < 3 {
			continue
		}

		stagedStatus := line[0]
		unstagedStatus := line[1]
		filename := strings.TrimSpace(line[3:])

		// Get diff for unstaged changes
		if unstagedStatus != ' ' && unstagedStatus != '?' {
			diff, added, removed := s.getFileDiff(filename, false)
			resp.Unstaged = append(resp.Unstaged, types.GitFileChange{
				Path:    filename,
				Diff:    diff,
				Added:   added,
				Removed: removed,
			})
		}

		// Handle newly added files in staged section (were untracked before staging)
		if stagedStatus == 'A' {
			// Read full file content (same approach as untracked files)
			content, err := s.files.Read(fmt.Sprintf("%s/%s", s.workingDir, filename))
			if err != nil {
				content = "Error reading file"
			}

			// Store raw content without prefixes for staged additions
			lines := strings.Split(content, "\n")
			addedCount := len(lines)

			// Store raw file content (no diff prefixes)
			var diffBuilder strings.Builder
			for _, line := range lines {
				diffBuilder.WriteString(line + "\n")
			}

			resp.Staged = append(resp.Staged, types.GitFileChange{
				Path:        filename,
				Diff:        diffBuilder.String(),
				Added:       addedCount,
				Removed:     0,
				IsUntracked: true, // Preserve untracked flag for staged additions
			})

			// If there are also unstaged modifications, handle them separately
			if unstagedStatus == 'M' || unstagedStatus == 'D' {
				diff, added, removed := s.getFileDiff(filename, false)
				resp.Unstaged = append(resp.Unstaged, types.GitFileChange{
					Path:    filename,
					Diff:    diff,
					Added:   added,
					Removed: removed,
				})
			}

			continue // Skip normal diff processing for this file
		}

		// Get diff for staged changes (other than additions)
		if stagedStatus != ' ' && stagedStatus != '?' && stagedStatus != 'A' {
			diff, added, removed := s.getFileDiff(filename, true)
			resp.Staged = append(resp.Staged, types.GitFileChange{
				Path:    filename,
				Diff:    diff,
				Added:   added,
				Removed: removed,
			})
		}

		// Handle untracked files
		if stagedStatus == '?' && unstagedStatus == '?' {
			// Read full file content
			content, err := s.files.Read(fmt.Sprintf("%s/%s", s.workingDir, filename))
			if err != nil {
				content = "Error reading file"
			}

			// Store raw content without prefixes for untracked files
			lines := strings.Split(content, "\n")
			addedCount := len(lines)

			// Store raw file content (no diff prefixes)
			var diffBuilder strings.Builder
			for _, line := range lines {
				diffBuilder.WriteString(line + "\n")
			}

			resp.Unstaged = append(resp.Unstaged, types.GitFileChange{
				Path:        filename,
				Diff:        diffBuilder.String(),
				Added:       addedCount,
				Removed:     0,
				IsUntracked: true,
			})
		}
	}

	return resp, nil
}

// getFileDiff gets the diff for a specific file
func (s *Service) getFileDiff(filename string, staged bool) (string, int, int) {
	var cmd string
	if staged {
		// Diff for staged changes
		cmd = fmt.Sprintf("cd %s && git diff --cached '%s'", s.workingDir, filename)
	} else {
		// Diff for unstaged changes
		cmd = fmt.Sprintf("cd %s && git diff '%s'", s.workingDir, filename)
	}

	output, err := s.exec.Run(cmd)
	if err != nil {
		return "", 0, 0
	}

	// Count additions and removals
	added := 0
	removed := 0
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			added++
		} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			removed++
		}
	}

	return output, added, removed
}

// Stage adds a file to the staging area
func (s *Service) Stage(filename string) error {
	cmd := fmt.Sprintf("cd %s && git add '%s'", s.workingDir, filename)
	_, err := s.exec.Run(cmd)
	return err
}

// Unstage removes a file from the staging area
func (s *Service) Unstage(filename string) error {
	cmd := fmt.Sprintf("cd %s && git reset HEAD '%s'", s.workingDir, filename)
	_, err := s.exec.Run(cmd)
	return err
}

// StageAll stages all changes
func (s *Service) StageAll() error {
	cmd := fmt.Sprintf("cd %s && git add -A", s.workingDir)
	_, err := s.exec.Run(cmd)
	return err
}

// UnstageAll unstages all changes
func (s *Service) UnstageAll() error {
	cmd := fmt.Sprintf("cd %s && git reset HEAD", s.workingDir)
	_, err := s.exec.Run(cmd)
	return err
}

// Discard discards changes to a file
func (s *Service) Discard(filename string) error {
	cmd := fmt.Sprintf("cd %s && git checkout -- '%s'", s.workingDir, filename)
	_, err := s.exec.Run(cmd)
	return err
}

// Commit commits staged changes
func (s *Service) Commit(message string) error {
	// Escape single quotes in commit message
	escapedMessage := strings.ReplaceAll(message, "'", "'\\''")

	cmd := fmt.Sprintf("cd %s && git commit -m '%s'", s.workingDir, escapedMessage)
	_, err := s.exec.Run(cmd)
	return err
}

// Pull pulls changes from remote
func (s *Service) Pull() error {
	cmd := fmt.Sprintf("cd %s && git pull", s.workingDir)
	_, err := s.exec.Run(cmd)
	return err
}

// Push pushes changes to remote
func (s *Service) Push() error {
	cmd := fmt.Sprintf("cd %s && git push", s.workingDir)
	_, err := s.exec.Run(cmd)
	return err
}

// GenerateContextDiff creates a fake unified diff with all lines as context
func GenerateContextDiff(filename string, content string) string {
	lines := strings.Split(content, "\n")
	lineCount := len(lines)

	// Handle empty files
	if lineCount == 0 || (lineCount == 1 && lines[0] == "") {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("--- a/%s\n", filename))
	sb.WriteString(fmt.Sprintf("+++ b/%s\n", filename))
	sb.WriteString(fmt.Sprintf("@@ -1,%d +1,%d @@\n", lineCount, lineCount))

	for _, line := range lines {
		sb.WriteString(" ") // Space prefix = context line
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	return sb.String()
}

// FileWithDiff returns file content with diff for the Code panel
func (s *Service) FileWithDiff(path string) (*types.FileWithDiffResponse, error) {
	resp := &types.FileWithDiffResponse{
		Type: "file_with_diff",
		Path: path,
	}

	// Read file content
	content, err := s.files.Read(path)
	if err != nil {
		return nil, err
	}
	resp.Content = content

	// Extract relative path for git commands
	// Path is like ~/projects/sample/README.md, workingDir is ~/projects/sample
	relativePath := path
	if strings.HasPrefix(path, s.workingDir+"/") {
		relativePath = strings.TrimPrefix(path, s.workingDir+"/")
	}

	// Check if file is tracked by git
	trackCmd := fmt.Sprintf("cd %s && git ls-files --error-unmatch '%s' 2>/dev/null", s.workingDir, relativePath)
	_, trackErr := s.exec.Run(trackCmd)
	if trackErr != nil {
		// File is not tracked - generate fake diff with all lines as context
		resp.IsUntracked = true
		resp.Diff = GenerateContextDiff(relativePath, content)
		return resp, nil
	}

	// Get unstaged diff with full file context (working tree vs index)
	// -U99999 ensures we get all lines as context, showing the entire file
	diffCmd := fmt.Sprintf("cd %s && git diff -U99999 '%s'", s.workingDir, relativePath)
	diff, _ := s.exec.Run(diffCmd)

	if len(strings.TrimSpace(diff)) > 0 {
		// File has changes
		resp.Diff = diff
		resp.HasDiff = true
	} else {
		// No changes - generate fake diff with all lines as context
		resp.Diff = GenerateContextDiff(relativePath, content)
		resp.HasDiff = false
	}

	return resp, nil
}
