//go:build windows

package daemon

import (
	"context"
	"os/exec"
	"syscall"
)

// createNewConsole allocates a fresh hidden console for the child process.
// Combined with HideWindow=true the console stays off-screen, and any
// grandchildren inherit this hidden console instead of allocating visible ones.
const createNewConsole = 0x00000010

// gitCommandContext creates an exec.Cmd for a git subprocess with Windows-specific
// process creation flags that suppress console window allocation.
func gitCommandContext(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewConsole,
	}
	return cmd
}
