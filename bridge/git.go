package main

import (
	"fmt"
	"strings"
)

// Git status - get list of changed files
func (s *Session) getGitStatus() (*GitStatusResponse, error) {
	// Execute git status with porcelain format
	cmd := fmt.Sprintf("cd %s && git status --porcelain", workingDir)
	output, err := s.executeCommand(cmd)
	if err != nil {
		return nil, err
	}

	resp := &GitStatusResponse{
		Type:     "git_status",
		Unstaged: []GitFileChange{},
		Staged:   []GitFileChange{},
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
			resp.Unstaged = append(resp.Unstaged, GitFileChange{
				Path:    filename,
				Diff:    diff,
				Added:   added,
				Removed: removed,
			})
		}

		// Handle newly added files in staged section (were untracked before staging)
		if stagedStatus == 'A' {
			// Read full file content (same approach as untracked files)
			content, err := s.readFile(fmt.Sprintf("%s/%s", workingDir, filename))
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

			resp.Staged = append(resp.Staged, GitFileChange{
				Path:        filename,
				Diff:        diffBuilder.String(),
				Added:       addedCount,
				Removed:     0,
				IsUntracked: true, // Preserve untracked flag for staged additions
			})

			// If there are also unstaged modifications, handle them separately
			if unstagedStatus == 'M' || unstagedStatus == 'D' {
				diff, added, removed := s.getFileDiff(filename, false)
				resp.Unstaged = append(resp.Unstaged, GitFileChange{
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
			resp.Staged = append(resp.Staged, GitFileChange{
				Path:    filename,
				Diff:    diff,
				Added:   added,
				Removed: removed,
			})
		}

		// Handle untracked files
		if stagedStatus == '?' && unstagedStatus == '?' {
			// Read full file content
			content, err := s.readFile(fmt.Sprintf("%s/%s", workingDir, filename))
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

			resp.Unstaged = append(resp.Unstaged, GitFileChange{
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

// Get diff for a specific file
func (s *Session) getFileDiff(filename string, staged bool) (string, int, int) {
	var cmd string
	if staged {
		// Diff for staged changes
		cmd = fmt.Sprintf("cd %s && git diff --cached '%s'", workingDir, filename)
	} else {
		// Diff for unstaged changes
		cmd = fmt.Sprintf("cd %s && git diff '%s'", workingDir, filename)
	}

	output, err := s.executeCommand(cmd)
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

// Stage a file
func (s *Session) stageFile(filename string) error {
	cmd := fmt.Sprintf("cd %s && git add '%s'", workingDir, filename)
	_, err := s.executeCommand(cmd)
	return err
}

// Unstage a file
func (s *Session) unstageFile(filename string) error {
	cmd := fmt.Sprintf("cd %s && git reset HEAD '%s'", workingDir, filename)
	_, err := s.executeCommand(cmd)
	return err
}

// Discard changes to a file
func (s *Session) discardFile(filename string) error {
	cmd := fmt.Sprintf("cd %s && git checkout -- '%s'", workingDir, filename)
	_, err := s.executeCommand(cmd)
	return err
}

// Commit staged changes
func (s *Session) commitChanges(message string) error {
	// Escape single quotes in commit message
	escapedMessage := strings.ReplaceAll(message, "'", "'\\''")

	cmd := fmt.Sprintf("cd %s && git commit -m '%s'", workingDir, escapedMessage)
	_, err := s.executeCommand(cmd)
	return err
}

// Pull changes from remote
func (s *Session) pullChanges() error {
	cmd := fmt.Sprintf("cd %s && git pull", workingDir)
	_, err := s.executeCommand(cmd)
	return err
}

// Push changes to remote
func (s *Session) pushChanges() error {
	cmd := fmt.Sprintf("cd %s && git push", workingDir)
	_, err := s.executeCommand(cmd)
	return err
}
