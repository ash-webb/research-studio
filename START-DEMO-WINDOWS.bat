@echo off
cd /d "%~dp0"
echo Research Studio local demo is starting.
echo Open http://localhost:8000/ in your browser.
echo Keep this window open while using the demo.
echo.
py -3 -m http.server 8000
if errorlevel 1 (
  echo Python launcher not found. Install Python 3, then run:
  echo python -m http.server 8000
  pause
)
