//go:build windows

package execenv

import (
	"context"
	"os/exec"
	"syscall"
)

// createNewConsole allocates a fresh hidden console for the child process.
// Combined with HideWindow=true the console stays off-screen, and any
// grandchildren (ssh, credential helpers) inherit this hidden console
// instead of each allocating their own visible one.
const createNewConsole = 0x00000010

// gitCommand creates an exec.Cmd for a git subprocess with Windows-specific
// process creation flags that suppress console window allocation.
func gitCommand(args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewConsole,
	}
	return cmd
}

// gitCommandContext is like gitCommand but accepts a context for cancellation.
func gitCommandContext(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewConsole,
	}
	return cmd
}
