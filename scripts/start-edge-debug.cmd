@echo off
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.edge-debug-profile"
echo Edge started with debugging on port 9222.
echo Navigate to https://aistudio.google.com and log in.
echo Then run: node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 --drive-ids "..."
