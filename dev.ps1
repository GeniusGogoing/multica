# Multica Dev - Windows one-click startup script
# Usage: .\dev.ps1 (in PowerShell)
#
# Options:
#   -NoDaemon    Skip daemon startup
#   -Stop        Stop all services

param(
    [switch]$NoDaemon,
    [switch]$Stop
)

$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$envFile = Join-Path $Root ".env"

# --- Helpers ---
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red }

function Load-Env {
    if (-not (Test-Path $envFile)) {
        Write-Step "Creating .env from .env.example..."
        Copy-Item (Join-Path $Root ".env.example") $envFile
    }
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

function Get-Port($name, $default) {
    $val = [System.Environment]::GetEnvironmentVariable($name, "Process")
    if ($val) { return [int]$val } else { return $default }
}

function Stop-OnPort($port) {
    $lines = netstat -ano | Select-String ":\b$port\b\s.*LISTENING"
    foreach ($line in $lines) {
        if ($line -match '\s(\d+)\s*$') {
            $procId = [int]$Matches[1]
            if ($procId -gt 0) {
                try {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    Write-Host "  Killed PID $procId on port $port" -ForegroundColor Yellow
                } catch {}
            }
        }
    }
}

# --- Stop mode ---
if ($Stop) {
    Load-Env
    $backendPort = Get-Port "PORT" 8080
    $frontendPort = Get-Port "FRONTEND_PORT" 3000
    Write-Step "Stopping services..."
    Stop-OnPort $backendPort
    Stop-OnPort $frontendPort
    # Stop daemon via its PID file
    $daemonPidFile = Join-Path $env:USERPROFILE ".multica\daemon.pid"
    if (Test-Path $daemonPidFile) {
        $procId = [int](Get-Content $daemonPidFile)
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        Write-Host "  Killed daemon PID $procId" -ForegroundColor Yellow
    }
    Write-Ok "All services stopped."
    exit 0
}

# --- Main ---
Write-Host ""
Write-Host "  Multica Dev Startup (Windows)" -ForegroundColor Magenta
Write-Host "  ==============================" -ForegroundColor Magenta
Write-Host ""

# Prerequisites
Write-Step "Checking prerequisites..."
$missing = @()
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) { $missing += "node" }
if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) { $missing += "pnpm" }
if (-not (Get-Command "go" -ErrorAction SilentlyContinue)) { $missing += "go" }
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) { $missing += "docker" }
if ($missing.Count -gt 0) {
    Write-Err "Missing: $($missing -join ', ')"
    Write-Host "  Install: Node.js v22+, pnpm v10.28+, Go v1.26+, Docker" -ForegroundColor Yellow
    exit 1
}
Write-Ok "All prerequisites found"

# Load .env
Load-Env
$backendPort = Get-Port "PORT" 8080
$frontendPort = Get-Port "FRONTEND_PORT" 3000

# Kill stale
Write-Step "Clearing stale processes on ports $backendPort, $frontendPort..."
Stop-OnPort $backendPort
Stop-OnPort $frontendPort

# Dependencies
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Step "Installing pnpm dependencies..."
    Push-Location $Root; pnpm install; Pop-Location
} else {
    Write-Ok "Dependencies already installed"
}

# PostgreSQL
Write-Step "Starting PostgreSQL..."
Push-Location $Root
docker compose up -d postgres 2>&1 | Out-Null
Pop-Location

Write-Step "Waiting for PostgreSQL..."
$pgReady = $false
for ($i = 0; $i -lt 30; $i++) {
    docker compose -f (Join-Path $Root "docker-compose.yml") exec -T postgres pg_isready -U multica 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if ($pgReady) { Write-Ok "PostgreSQL ready" }
else { Write-Err "PostgreSQL not ready - check Docker"; exit 1 }

# Migrations
Write-Step "Running database migrations..."
Push-Location (Join-Path $Root "server")
go run ./cmd/migrate up 2>&1 | Select-String -NotMatch "^\s*skip" | Write-Host
Pop-Location
Write-Ok "Migrations done"

# --- Start services as child processes (inherit full environment) ---
$logDir = Join-Path $Root ".dev-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Backend
Write-Step "Starting Go backend (port $backendPort)..."
$backendLog = Join-Path $logDir "backend.log"
$backendProc = Start-Process -FilePath "go" `
    -ArgumentList "run", "./cmd/server" `
    -WorkingDirectory (Join-Path $Root "server") `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError (Join-Path $logDir "backend-err.log") `
    -PassThru -WindowStyle Hidden

# Frontend — use `next dev --port X` directly to avoid sh dependency
Write-Step "Starting Next.js frontend (port $frontendPort)..."
$frontendLog = Join-Path $logDir "frontend.log"
$nextBin = Join-Path $Root "apps\web\node_modules\.bin\next.cmd"
if (-not (Test-Path $nextBin)) {
    $nextBin = Join-Path $Root "node_modules\.bin\next.cmd"
}
$frontendProc = Start-Process -FilePath $nextBin `
    -ArgumentList "dev", "--port", "$frontendPort" `
    -WorkingDirectory (Join-Path $Root "apps\web") `
    -RedirectStandardOutput $frontendLog `
    -RedirectStandardError (Join-Path $logDir "frontend-err.log") `
    -PassThru -WindowStyle Hidden

# Daemon
$daemonProc = $null
if (-not $NoDaemon) {
    Write-Step "Starting daemon..."
    $daemonLog = Join-Path $logDir "daemon.log"
    $daemonProc = Start-Process -FilePath "go" `
        -ArgumentList "run", "./cmd/multica", "daemon", "start", "--foreground" `
        -WorkingDirectory (Join-Path $Root "server") `
        -RedirectStandardOutput $daemonLog `
        -RedirectStandardError (Join-Path $logDir "daemon-err.log") `
        -PassThru -WindowStyle Hidden
}

# Health checks
Write-Step "Waiting for services to be ready..."
Start-Sleep -Seconds 3

$backendOk = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:$backendPort/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($resp.status -eq "ok") { $backendOk = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}

$frontendOk = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$frontendPort" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $frontendOk = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 1000
}

# Summary
Write-Host ""
Write-Host "  ==============================" -ForegroundColor Magenta
Write-Host "  Status:" -ForegroundColor Magenta
Write-Host ""
if ($backendOk)  { Write-Ok "Backend:  http://localhost:$backendPort  (PID $($backendProc.Id))" }
else             { Write-Err "Backend:  FAILED" }
if ($frontendOk) { Write-Ok "Frontend: http://localhost:$frontendPort  (PID $($frontendProc.Id))" }
else             { Write-Err "Frontend: FAILED" }
if ($daemonProc) { Write-Ok "Daemon:   running (PID $($daemonProc.Id))" }
Write-Host ""
Write-Host "  Logs: $logDir" -ForegroundColor Gray
Write-Host ""

# Show errors if failed
if (-not $backendOk) {
    Write-Host "--- Backend error log ---" -ForegroundColor Yellow
    if (Test-Path (Join-Path $logDir "backend-err.log")) {
        Get-Content (Join-Path $logDir "backend-err.log") | Select-Object -Last 15
    }
    if (Test-Path $backendLog) {
        Get-Content $backendLog | Select-Object -Last 15
    }
}
if (-not $frontendOk) {
    Write-Host "--- Frontend error log ---" -ForegroundColor Yellow
    if (Test-Path (Join-Path $logDir "frontend-err.log")) {
        Get-Content (Join-Path $logDir "frontend-err.log") | Select-Object -Last 15
    }
    if (Test-Path $frontendLog) {
        Get-Content $frontendLog | Select-Object -Last 15
    }
}

if (-not ($backendOk -and $frontendOk)) { exit 1 }

# Wait for Ctrl+C, then cleanup
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Gray
Write-Host ""
try {
    # Tail logs in real-time (open with FileShare.ReadWrite to avoid locking conflicts)
    $fsBackend = [System.IO.FileStream]::new($backendLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $backendStream = [System.IO.StreamReader]::new($fsBackend)
    $fsFrontend = [System.IO.FileStream]::new($frontendLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $frontendStream = [System.IO.StreamReader]::new($fsFrontend)
    $daemonStream = $null
    $fsDaemon = $null
    if ($daemonProc) {
        $fsDaemon = [System.IO.FileStream]::new($daemonLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $daemonStream = [System.IO.StreamReader]::new($fsDaemon)
    }
    # Skip to end
    $backendStream.ReadToEnd() | Out-Null
    $frontendStream.ReadToEnd() | Out-Null
    if ($daemonStream) { $daemonStream.ReadToEnd() | Out-Null }

    while ($true) {
        $line = $backendStream.ReadLine()
        while ($line) {
            Write-Host "[backend] $line" -ForegroundColor DarkCyan
            $line = $backendStream.ReadLine()
        }
        $line = $frontendStream.ReadLine()
        while ($line) {
            Write-Host "[frontend] $line" -ForegroundColor DarkGreen
            $line = $frontendStream.ReadLine()
        }
        if ($daemonStream) {
            $line = $daemonStream.ReadLine()
            while ($line) {
                Write-Host "[daemon] $line" -ForegroundColor DarkMagenta
                $line = $daemonStream.ReadLine()
            }
        }
        # Check if processes died
        if ($backendProc.HasExited) { Write-Err "Backend exited!"; break }
        if ($frontendProc.HasExited) { Write-Err "Frontend exited!"; break }
        Start-Sleep -Milliseconds 300
    }
} finally {
    Write-Host ""
    Write-Step "Shutting down..."
    if ($backendStream) { $backendStream.Close() }
    if ($fsBackend) { $fsBackend.Close() }
    if ($frontendStream) { $frontendStream.Close() }
    if ($fsFrontend) { $fsFrontend.Close() }
    if ($daemonStream) { $daemonStream.Close() }
    if ($fsDaemon) { $fsDaemon.Close() }
    if (-not $backendProc.HasExited) { Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue }
    if (-not $frontendProc.HasExited) { Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue }
    if ($daemonProc -and (-not $daemonProc.HasExited)) { Stop-Process -Id $daemonProc.Id -Force -ErrorAction SilentlyContinue }
    Write-Ok "All services stopped."
}
