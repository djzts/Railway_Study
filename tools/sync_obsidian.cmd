@echo off
rem Sync study progress from the website into the Obsidian vault. Options: node tools\sync_obsidian.js --help
chcp 65001 >nul
cd /d "%~dp0.."
node tools\sync_obsidian.js %*
if "%~1"=="" pause
