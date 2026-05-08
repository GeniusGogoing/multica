//go:build !windows

package repocache

import "os/exec"

// gitCommand creates an exec.Cmd for a git subprocess. On non-Windows platforms
// no special process attributes are needed.
func gitCommand(args ...string) *exec.Cmd {
	return exec.Command("git", args...)
}
