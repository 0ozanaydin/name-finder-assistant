@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kur ve tekrar dene.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo .env olusturuldu. Acilan dosyaya GEMINI_API_KEY degerini yaz, kaydet ve bu dosyayi tekrar calistir.
  notepad .env
  pause
  exit /b 0
)
start "" http://localhost:3000
node server.js
pause
