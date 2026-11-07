@echo off
setlocal
cd /d "%~dp0"
echo Downloading original Nabil Fx image assets...
where curl >nul 2>nul
if errorlevel 1 (
  echo ERROR: curl was not found. Windows 10/11 normally includes curl.
  echo Download these files manually from the repository and place them beside index.html:
  echo https://github.com/nabilmahmud3301-source/nabil-fx/blob/main/hero-banner.png
  echo https://github.com/nabilmahmud3301-source/nabil-fx/blob/main/profile-photo.jpg
  pause
  exit /b 1
)
curl -L --fail --silent --show-error "https://raw.githubusercontent.com/nabilmahmud3301-source/nabil-fx/main/hero-banner.png" -o "hero-banner.png"
if errorlevel 1 goto fail
curl -L --fail --silent --show-error "https://raw.githubusercontent.com/nabilmahmud3301-source/nabil-fx/main/profile-photo.jpg" -o "profile-photo.jpg"
if errorlevel 1 goto fail
echo.
echo SUCCESS: hero-banner.png and profile-photo.jpg downloaded.
echo Keep both files in the same folder as index.html.
pause
exit /b 0
:fail
echo.
echo Download failed. Check internet access or download the images manually from the GitHub repository.
pause
exit /b 1
