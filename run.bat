@echo off
title SleepGuard AI Monitor
echo ===================================================
echo             Starting SleepGuard AI...
echo ===================================================
echo.

:: Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python detected. Starting server on http://localhost:3000...
    start "" http://localhost:3000
    python -m http.server 3000
    goto end
)

:: Check if Python launcher (py) is installed
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python launcher detected. Starting server on http://localhost:3000...
    start "" http://localhost:3000
    py -m http.server 3000
    goto end
)

:: If Python is not installed, use built-in Windows PowerShell web server
echo [INFO] Python not found.
echo [INFO] Using built-in Windows PowerShell local server (zero install required)...
start "" http://localhost:3000
powershell -ExecutionPolicy Bypass -Command "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:3000/'); $listener.Start(); Write-Host '>>> SleepGuard running at http://localhost:3000 (Close this window to stop)'; while ($listener.IsListening) { try { $context = $listener.GetContext(); $req = $context.Request; $res = $context.Response; $rel = $req.Url.LocalPath.TrimStart('/'); if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }; $target = Join-Path (Get-Location) $rel; if (Test-Path $target -PathType Leaf) { $ext = [IO.Path]::GetExtension($target).ToLower(); $res.ContentType = switch ($ext) { '.html' {'text/html; charset=utf-8'} '.js' {'application/javascript; charset=utf-8'} '.css' {'text/css; charset=utf-8'} '.json' {'application/json'} '.svg' {'image/svg+xml'} '.png' {'image/png'} '.jpg' {'image/jpeg'} default {'application/octet-stream'} }; $data = [IO.File]::ReadAllBytes($target); $res.ContentLength64 = $data.Length; $res.OutputStream.Write($data, 0, $data.Length) } else { $res.StatusCode = 404 }; $res.Close() } catch {} }"

:end
pause
