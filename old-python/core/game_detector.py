"""
GameVault - Game Save Backup Tool
Game detector - finds games and their save locations
"""

import os
import json
from pathlib import Path
from typing import Optional, List, Dict, Any


class GameDetector:
    """Detects installed games and their save file locations"""
    
    def __init__(self, games_db_path: str):
        self.games_db_path = Path(games_db_path)
        self.games_db = self._load_games_db()
    
    def _load_games_db(self) -> Dict[str, Any]:
        """Load the games database"""
        if not self.games_db_path.exists():
            return {"games": []}
        
        try:
            with open(self.games_db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"games": []}
    
    def get_all_games(self) -> List[Dict[str, Any]]:
        """Get all games from the database"""
        return self.games_db.get("games", [])
    
    def get_game_by_id(self, game_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific game by ID"""
        for game in self.games_db.get("games", []):
            if game.get("id") == game_id:
                return game
        return None
    
    def detect_installed_games(self) -> List[Dict[str, Any]]:
        """
        Detect which games from the database are installed
        by checking if their save paths exist
        """
        installed = []
        
        for game in self.games_db.get("games", []):
            for save_path in game.get("save_paths", []):
                expanded_path = os.path.expandvars(save_path)
                if Path(expanded_path).exists():
                    game_copy = game.copy()
                    game_copy["detected_path"] = expanded_path
                    game_copy["is_installed"] = True
                    installed.append(game_copy)
                    break
            else:
                # Game not found, but still include in list
                game_copy = game.copy()
                game_copy["detected_path"] = None
                game_copy["is_installed"] = False
                # installed.append(game_copy)  # Uncomment to show all games
        
        return installed
    
    def expand_save_path(self, path: str) -> str:
        """Expand environment variables in a path"""
        return os.path.expandvars(path)
    
    def validate_save_path(self, path: str) -> Dict[str, Any]:
        """
        Validate a save path and get info about it
        """
        expanded = self.expand_save_path(path)
        path_obj = Path(expanded)
        
        if not path_obj.exists():
            return {
                "valid": False,
                "exists": False,
                "path": expanded,
                "error": "Path does not exist"
            }
        
        # Get info about the path
        if path_obj.is_dir():
            files = list(path_obj.rglob("*"))
            file_count = len([f for f in files if f.is_file()])
            total_size = sum(f.stat().st_size for f in files if f.is_file())
        else:
            file_count = 1
            total_size = path_obj.stat().st_size
        
        return {
            "valid": True,
            "exists": True,
            "path": expanded,
            "is_directory": path_obj.is_dir(),
            "file_count": file_count,
            "total_size": total_size,
            "error": None
        }
    
    def search_games(self, query: str) -> List[Dict[str, Any]]:
        """Search for games by name"""
        query = query.lower().strip()
        if not query:
            return self.get_all_games()
        
        results = []
        for game in self.games_db.get("games", []):
            name = game.get("name", "").lower()
            developer = game.get("developer", "").lower()
            
            if query in name or query in developer:
                results.append(game)
        
        return results
    
    def add_custom_game(self, game_data: Dict[str, Any]) -> bool:
        """Add a custom game to the database"""
        # Generate ID from name
        game_id = game_data.get("name", "custom").lower().replace(" ", "_")
        game_id = "".join(c for c in game_id if c.isalnum() or c == "_")
        
        # Check for duplicates
        for existing in self.games_db.get("games", []):
            if existing.get("id") == game_id:
                # Update existing
                existing.update(game_data)
                self._save_games_db()
                return True
        
        # Add new game
        new_game = {
            "id": game_id,
            "name": game_data.get("name", "Unknown"),
            "developer": game_data.get("developer", ""),
            "icon": game_data.get("icon", ""),
            "save_paths": game_data.get("save_paths", []),
            "extensions": game_data.get("extensions", []),
            "notes": game_data.get("notes", ""),
            "custom": True
        }
        
        self.games_db.setdefault("games", []).append(new_game)
        self._save_games_db()
        return True
    
    def _save_games_db(self):
        """Save the games database"""
        try:
            with open(self.games_db_path, "w", encoding="utf-8") as f:
                json.dump(self.games_db, f, indent=2)
        except Exception:
            pass
