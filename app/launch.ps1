# Opens VBL Stats in its own app window (Edge/Chrome --app mode, no tabs or address bar).
# Starts the local server if it isn't already running, and stops it again when the window closes.
# Run via "VBL Stats.vbs" so no console window flashes up.

$ErrorActionPreference = 'Stop'
$port = 5199 # separate from the dev server (5173) so both can run at once
$root = Split-Path $PSScriptRoot
$url = "http://localhost:$port/"

function Test-Server {
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch { return $false }
}

$server = $null
if (-not (Test-Server)) {
    $env:PORT = $port # serve.js reads PORT; the child process inherits it
    $server = Start-Process -FilePath 'node' -ArgumentList "`"$root\serve.js`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 50 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 100 }
}

$browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
    # Its own profile folder means this window is its own browser process, so we can wait for it to close.
    # (If the app is already open, this hands off to that window and returns straight away.)
    $profileDir = Join-Path $env:LOCALAPPDATA 'VBLStats\browser'
    # Without the sync/sign-in flags Edge quietly signs this fresh profile into the Windows Microsoft account
    # and starts syncing browsing data into it, with a popup on first launch.
    $flags = @(
        "--app=$url", "--user-data-dir=`"$profileDir`"", '--window-size=1400,900', '--no-first-run',
        '--disable-sync', '--disable-features=msImplicitSignin,msEdgeSyncConsentDialog,EdgeImplicitSignIn'
    )
    $app = Start-Process -FilePath $browser -ArgumentList $flags -PassThru
    $app.WaitForExit()
    # Wait until no window is using our profile any more (covers the hand-off case above).
    while (Get-CimInstance Win32_Process -Filter "Name='$(Split-Path $browser -Leaf)'" | Where-Object { $_.CommandLine -like "*VBLStats\browser*" }) {
        Start-Sleep -Seconds 2
    }
} else {
    # No Edge/Chrome found: fall back to the default browser and leave the server running.
    Start-Process $url
    exit
}

if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
