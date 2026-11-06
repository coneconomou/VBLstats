# Opens Pregame in its own app window (Edge/Chrome --app mode, no tabs or address bar).
# Starts the local server if it isn't already running, and stops it again when the window closes.
# Run via "Pregame.vbs" so no console window flashes up.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
# Folder keeps its pre-rebrand name so saved settings carry over.
$profileDir = Join-Path $env:LOCALAPPDATA 'VBLStats\browser'

function Show-Error([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, 'Pregame', 'OK', 'Error') | Out-Null
}

# True only if *our* server answers on this port (serve.js /__vblstats), not just any program.
function Test-OurServer([int]$port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/__vblstats" -TimeoutSec 2
        return $r.Content -eq 'vblstats'
    } catch { return $false }
}

function Test-PortInUse([int]$port) {
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch { return $false }
}

$server = $null
try {
    # 5199 normally (separate from the dev server on 5173). If another program has it, try the next few.
    $port = $null
    foreach ($p in 5199..5209) {
        if (Test-OurServer $p) { $port = $p; break } # already running (app opened twice): reuse it
        if (Test-PortInUse $p) { continue }          # some other program: skip
        $env:PORT = $p # serve.js reads PORT; the child process inherits it
        $server = Start-Process -FilePath 'node' -ArgumentList "`"$root\serve.js`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru
        for ($i = 0; $i -lt 50; $i++) {
            if (Test-OurServer $p) { $port = $p; break }
            if ($server.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        if (-not $port) {
            $code = if ($server.HasExited) { $server.ExitCode } else { 'none (timed out)' }
            throw "The Pregame server didn't start (exit code: $code). Is Node.js installed?"
        }
        break
    }
    if (-not $port) { throw 'Ports 5199-5209 are all in use by other programs.' }
    $url = "http://localhost:$port/"

    $browsers = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $browser) {
        # No Edge/Chrome: use the default browser. We can't tell when it closes, so leave the server running.
        Start-Process $url
        $server = $null
        return
    }

    # Its own profile folder means this window is its own browser process, so we can wait for it to close.
    # (If the app is already open, this hands off to that window and returns straight away.)
    # Without the sync/sign-in flags Edge quietly signs this fresh profile into the Windows Microsoft account
    # and starts syncing browsing data into it, with a popup on first launch.
    $flags = @(
        "--app=$url", "--user-data-dir=`"$profileDir`"", '--window-size=1400,900', '--no-first-run',
        '--disable-sync', '--disable-features=msImplicitSignin,msEdgeSyncConsentDialog,EdgeImplicitSignIn'
    )
    $app = Start-Process -FilePath $browser -ArgumentList $flags -PassThru
    $app.WaitForExit()
    # Wait until no window is using our profile any more (covers the hand-off case above).
    $exe = Split-Path $browser -Leaf
    while (Get-CimInstance Win32_Process -Filter "Name='$exe'" | Where-Object { $_.CommandLine -like '*VBLStats\browser*' }) {
        Start-Sleep -Seconds 2
    }
} catch {
    Show-Error $_.Exception.Message
} finally {
    # Only stop a server this launch started; a reused one belongs to the window that's still open.
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
