//go:build !windows

package daemon

import (
	"context"
	"os/exec"
)

// gitCommandContext creates an exec.Cmd for a git subprocess. On non-Windows
// platforms no special process attributes are needed.
func gitCommandContext(ctx context.Context, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, "git", args...)
}
