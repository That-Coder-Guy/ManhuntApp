@echo off
rem Builds the Android app and installs it on the phone plugged into this PC.
rem Options are passed on to install.mjs (try: android\install.cmd --help).
node "%~dp0install.mjs" %*
