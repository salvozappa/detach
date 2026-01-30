package files

import (
	"fmt"
	"strconv"
	"strings"

	"detach.it/bridge/internal/executor"
	"detach.it/bridge/internal/types"
)

// Service handles file operations
type Service struct {
	exec       executor.Executor
	workingDir string
}

// NewService creates a new file service
func NewService(exec executor.Executor, workingDir string) *Service {
	return &Service{
		exec:       exec,
		workingDir: workingDir,
	}
}

// List returns files in a directory
func (s *Service) List(path string) ([]types.FileInfo, error) {
	// Use ls -la with specific format for parsing
	output, err := s.exec.Run("ls -la " + path)
	if err != nil {
		return nil, err
	}

	var files []types.FileInfo
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total") {
			continue
		}

		// Parse ls -la output: drwxr-xr-x 2 user group 4096 Jan 1 12:00 filename
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}

		name := strings.Join(fields[8:], " ")
		if name == "." || name == ".." || name == ".claude" {
			continue
		}

		isDir := strings.HasPrefix(fields[0], "d")
		size, _ := strconv.ParseInt(fields[4], 10, 64)

		files = append(files, types.FileInfo{
			Name:  name,
			IsDir: isDir,
			Size:  size,
		})
	}

	// Check which files are git-ignored
	if len(files) > 0 {
		ignoredSet := s.getIgnoredFiles(path, files)

		// Convert path to relative path from workingDir for matching
		relDir := path
		if strings.HasPrefix(path, s.workingDir+"/") {
			relDir = strings.TrimPrefix(path, s.workingDir+"/")
		} else if path == s.workingDir {
			relDir = "."
		}

		for i := range files {
			var relPath string
			if relDir == "." {
				relPath = files[i].Name
			} else {
				relPath = relDir + "/" + files[i].Name
			}
			if ignoredSet[relPath] {
				files[i].IsIgnored = true
			}
		}
	}

	return files, nil
}

// getIgnoredFiles checks which files are git-ignored using git check-ignore
func (s *Service) getIgnoredFiles(dir string, files []types.FileInfo) map[string]bool {
	ignoredSet := make(map[string]bool)

	// Convert directory to relative path from workingDir
	relDir := dir
	if strings.HasPrefix(dir, s.workingDir+"/") {
		relDir = strings.TrimPrefix(dir, s.workingDir+"/")
	} else if dir == s.workingDir {
		relDir = "."
	}

	// Build list of relative file paths to check
	var pathsToCheck []string
	for _, f := range files {
		var relPath string
		if relDir == "." {
			relPath = f.Name
		} else {
			relPath = relDir + "/" + f.Name
		}
		pathsToCheck = append(pathsToCheck, relPath)
	}

	if len(pathsToCheck) == 0 {
		return ignoredSet
	}

	// Quote each path and join them
	var quotedPaths []string
	for _, p := range pathsToCheck {
		quotedPaths = append(quotedPaths, "'"+strings.ReplaceAll(p, "'", "'\\''")+"'")
	}
	pathsArg := strings.Join(quotedPaths, " ")

	// Use git check-ignore from the working directory
	// The command returns only the paths that are ignored
	cmd := fmt.Sprintf("cd %s && git check-ignore %s 2>/dev/null", s.workingDir, pathsArg)
	output, _ := s.exec.Run(cmd)

	// Parse output - each line is an ignored path (relative to workingDir)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			ignoredSet[line] = true
		}
	}

	return ignoredSet
}

// Read returns file content
func (s *Service) Read(path string) (string, error) {
	return s.exec.Run("cat " + path)
}
