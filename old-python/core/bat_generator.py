"""
GameVault - Game Save Backup Tool
.bat file generator for quick backup shortcuts
"""

import os
from pathlib import Path
from typing import Optional


class BatGenerator:
    """Generates .bat files for quick backup shortcuts"""
    
    BAT_TEMPLATE = '''@echo off
title GameVault - {game_name} Backup
echo ============================================
echo   GameVault Quick Backup
echo   Game: {game_name}
echo ============================================
echo.
echo Starting backup...
echo.

cd /d "{app_dir}"
python main.py --backup "{game_id}"

echo.
echo ============================================
echo   Backup complete!
echo ============================================
echo.
pause
'''

    BAT_TEMPLATE_EXE = '''@echo off
title GameVault - {game_name} Backup
echo ============================================
echo   GameVault Quick Backup
echo   Game: {game_name}
echo ============================================
echo.
echo Starting backup...
echo.

"{exe_path}" --backup "{game_id}"

echo.
echo ============================================
echo   Backup complete!
echo ============================================
echo.
pause
'''
    
    def __init__(self, app_dir: str, exe_path: Optional[str] = None):
        """
        Initialize the bat generator
        
        Args:
            app_dir: Directory where main.py is located
            exe_path: Optional path to compiled .exe (for distribution)
        """
        self.app_dir = Path(app_dir)
        self.exe_path = Path(exe_path) if exe_path else None
    
    def generate_bat(
        self, 
        game_id: str, 
        game_name: str, 
        output_dir: Optional[str] = None
    ) -> str:
        """
        Generate a .bat file for quick backup
        
        Args:
            game_id: The game's unique ID
            game_name: Display name of the game
            output_dir: Where to save the .bat file (defaults to app_dir)
            
        Returns:
            Path to the generated .bat file
        """
        output_dir = Path(output_dir) if output_dir else self.app_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Clean game name for filename
        safe_name = "".join(c for c in game_name if c.isalnum() or c in " _-").strip()
        bat_filename = f"Backup_{safe_name}.bat"
        bat_path = output_dir / bat_filename
        
        # Use exe template if exe exists, otherwise python template
        if self.exe_path and self.exe_path.exists():
            content = self.BAT_TEMPLATE_EXE.format(
                game_name=game_name,
                game_id=game_id,
                exe_path=str(self.exe_path)
            )
        else:
            content = self.BAT_TEMPLATE.format(
                game_name=game_name,
                game_id=game_id,
                app_dir=str(self.app_dir)
            )
        
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(content)
        
        return str(bat_path)
    
    def generate_all_bats(
        self, 
        games: list, 
        output_dir: Optional[str] = None
    ) -> list:
        """
        Generate .bat files for multiple games
        
        Args:
            games: List of game dicts with 'id' and 'name' keys
            output_dir: Where to save the .bat files
            
        Returns:
            List of generated .bat file paths
        """
        results = []
        for game in games:
            game_id = game.get("id")
            game_name = game.get("name")
            
            if game_id and game_name:
                bat_path = self.generate_bat(game_id, game_name, output_dir)
                results.append({
                    "game_id": game_id,
                    "game_name": game_name,
                    "bat_path": bat_path
                })
        
        return results
    
    def delete_bat(self, game_name: str, output_dir: Optional[str] = None) -> bool:
        """Delete a .bat file for a game"""
        output_dir = Path(output_dir) if output_dir else self.app_dir
        
        safe_name = "".join(c for c in game_name if c.isalnum() or c in " _-").strip()
        bat_filename = f"Backup_{safe_name}.bat"
        bat_path = output_dir / bat_filename
        
        if bat_path.exists():
            bat_path.unlink()
            return True
        return False
