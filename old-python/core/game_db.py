"""
GameVault - Game Database
Manages the database of known games and their save paths.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional


class GameDatabase:
    """Game database for searching and managing known games."""
    
    def __init__(self, data_dir: Optional[Path] = None):
        """Initialize game database.
        
        Args:
            data_dir: Directory containing games.json. Defaults to data/ in package.
        """
        if data_dir:
            self.data_dir = Path(data_dir)
        else:
            # Default to data directory relative to this file
            self.data_dir = Path(__file__).parent.parent / "data"
        
        self.games_file = self.data_dir / "games.json"
        self._games: List[Dict[str, Any]] = []
        self._load()
    
    def _load(self) -> None:
        """Load games from JSON file."""
        if self.games_file.exists():
            try:
                with open(self.games_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._games = data.get("games", [])
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load games database: {e}")
                self._games = []
    
    def get_all_games(self) -> List[Dict[str, Any]]:
        """Get all games in the database.
        
        Returns:
            List of all game dictionaries.
        """
        return self._games.copy()
    
    def get_game(self, game_id: str) -> Optional[Dict[str, Any]]:
        """Get a game by ID.
        
        Args:
            game_id: Game ID to find.
            
        Returns:
            Game dictionary or None if not found.
        """
        for game in self._games:
            if game.get("id") == game_id:
                return game.copy()
        return None
    
    def search_games(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search games by name or developer.
        
        Args:
            query: Search query (case-insensitive).
            limit: Maximum results to return.
            
        Returns:
            List of matching games.
        """
        if not query:
            return self._games[:limit]
        
        query_lower = query.lower()
        results = []
        
        # First pass: starts with query
        for game in self._games:
            name = game.get("name", "").lower()
            if name.startswith(query_lower):
                results.append(game.copy())
        
        # Second pass: contains query
        for game in self._games:
            if game in results:
                continue
            name = game.get("name", "").lower()
            developer = game.get("developer", "").lower()
            if query_lower in name or query_lower in developer:
                results.append(game.copy())
        
        return results[:limit]
    
    def get_games_by_developer(self, developer: str) -> List[Dict[str, Any]]:
        """Get all games by a specific developer.
        
        Args:
            developer: Developer name (case-insensitive).
            
        Returns:
            List of games by that developer.
        """
        developer_lower = developer.lower()
        return [
            game.copy() for game in self._games 
            if game.get("developer", "").lower() == developer_lower
        ]
    
    def get_developers(self) -> List[str]:
        """Get list of unique developers.
        
        Returns:
            Sorted list of developer names.
        """
        devs = set()
        for game in self._games:
            dev = game.get("developer", "")
            if dev:
                devs.add(dev)
        return sorted(devs)
    
    def game_count(self) -> int:
        """Get total number of games in database.
        
        Returns:
            Number of games.
        """
        return len(self._games)
