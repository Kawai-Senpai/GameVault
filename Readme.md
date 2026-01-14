# GameVault - Game Save Backup Manager

A modern, easy-to-use Windows app for backing up your game save files with rolling backup support.

## Features

- 🎮 **Auto-detect games** - Automatically finds popular games and their save locations
- 💾 **Rolling backups** - Keep N most recent backups, older ones auto-delete
- 📁 **Manual game addition** - Add any game with custom save paths
- 📝 **Quick backup shortcuts** - Generate .bat files for one-click backups
- 🎨 **Modern dark UI** - Clean, intuitive interface
- ⚡ **CLI support** - Backup games from command line

## Supported Games (Auto-detect)

- Elden Ring / Nightreign
- Dark Souls III
- Sekiro: Shadows Die Twice
- Minecraft
- Stardew Valley
- Hollow Knight
- Cyberpunk 2077
- The Witcher 3
- GTA V
- Skyrim (Original & Special Edition)
- Baldur's Gate 3
- Hades
- Terraria
- Valheim
- Monster Hunter: World
- Resident Evil 4 Remake
- And more...

## Installation

### Option 1: Run from Source
```bash
# Install dependencies
pip install -r requirements.txt

# Run the app
python main.py
```

### Option 2: Build Executable
```bash
# Double-click build.bat or run:
build.bat

# Find the exe in dist/GameVault.exe
```

## Usage

### GUI Mode
1. Run `python main.py` or `GameVault.exe`
2. Go to **Settings** and set your backup directory
3. Select a game from the sidebar
4. Click **Backup Now** to create a backup

### CLI Mode
```bash
# List available games
python main.py --list-games

# Backup a specific game
python main.py --backup elden_ring
```

### Quick Shortcuts
1. Select a game
2. Click **Create Shortcut**
3. Choose where to save the .bat file (e.g., Desktop)
4. Double-click the .bat anytime to backup that game

## Project Structure

```
GameVault/
├── main.py              # Entry point
├── requirements.txt     # Python dependencies
├── build.bat            # Build script for .exe
├── core/
│   ├── backup_engine.py # Backup logic
│   ├── game_detector.py # Game detection
│   └── bat_generator.py # Shortcut generator
├── ui/
│   └── main_window.py   # GUI
├── data/
│   ├── games.json       # Game database
│   └── config.json      # User settings
└── assets/              # Icons (optional)
```

## Adding Custom Games

1. Click **Add Game** in the sidebar
2. Enter the game name
3. Browse to the save folder location
4. Click **Add Game**

## License

MIT License - Free to use and modify!
