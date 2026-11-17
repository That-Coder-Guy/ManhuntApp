@echo off
rem Builds the iOS app inside WSL and installs it on the iPhone plugged into
rem this PC. Options are passed on to build.sh (try: ios\install.cmd --help).
cd /d "%~dp0"
wsl -e bash -lc "./build.sh %*"
