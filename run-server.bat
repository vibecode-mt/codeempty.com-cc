@echo off
setlocal

cd /d "%~dp0"

if not defined NVM_SYMLINK set "NVM_SYMLINK=C:\nvm4w\nodejs"
set "PATH=%NVM_SYMLINK%;%PATH%"

if not exist "dist" (
  call "%NVM_SYMLINK%\npm.cmd" run build
  if errorlevel 1 exit /b 1
)

call "%NVM_SYMLINK%\npm.cmd" run dev
