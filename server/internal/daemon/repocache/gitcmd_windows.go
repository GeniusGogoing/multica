//go:build windows

package repocache

import (
	"os/exec"
	"syscall"
)

// createNewConsole allocates a fresh hidden console for the child process.
// Combined with HideWindow=true the console stays off-screen, and — critically
// — any grandchildren the git process spawns (ssh, credential helpers) inherit
// this hidden console instead of each allocating their own visible one.
//
// Using CREATE_NO_WINDOW would strip the console entirely, forcing grandchild
// console programs (like ssh.exe) to allocate a new visible console window.
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
