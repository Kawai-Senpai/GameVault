@echo off
echo ================================
echo   GameVault - Build Executable
echo ================================
echo.

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found in PATH!
    pause
    exit /b 1
)

:: Install requirements
echo Installing dependencies...
pip install -r requirements.txt
pip install pyinstaller

echo.
echo Building executable...

:: Build with PyInstaller (uses PNG icon, converts to ICO automatically)
pyinstaller --onefile --windowed ^
    --name "GameVault" ^
    --icon "assets/GameVault.png" ^
    --add-data "data;data" ^
    --add-data "assets;assets" ^
    main.py

echo.
echo ================================
echo   Build complete!
echo   Executable: dist/GameVault.exe
echo ================================
pause
