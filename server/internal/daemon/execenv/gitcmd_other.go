//go:build !windows

package execenv

import (
	"context"
	"os/exec"
)

// gitCommand creates an exec.Cmd for a git subprocess. On non-Windows platforms
// no special process attributes are needed.
func gitCommand(args ...string) *exec.Cmd {
	return exec.Command("git", args...)
}

// gitCommandContext is like gitCommand but accepts a context for cancellation.
func gitCommandContext(ctx context.Context, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, "git", args...)
}
