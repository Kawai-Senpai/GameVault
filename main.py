"""
GameVault - Game Save Backup Tool
Main application entry point
"""

import sys
import os
import json
import argparse
from pathlib import Path

# Add the project root to path
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))

from core import BackupEngine, GameDetector, BatGenerator


def load_config():
    """Load configuration"""
    config_path = PROJECT_ROOT / "data" / "config.json"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "backup_directory": "",
        "max_backups": 10,
        "user_games": [],
        "backup_collections": {},
        "theme": "dark"
    }


def get_collection_retention(config, game_id: str, collection_id: str = "default"):
    default_limit = config.get("max_backups", 10)
    try:
        default_limit = int(default_limit)
    except (TypeError, ValueError):
        default_limit = 10

    collections = config.get("backup_collections", {}).get(game_id, [])
    for collection in collections:
        if collection.get("id") == collection_id:
            enabled = bool(collection.get("limit_enabled", False))
            limit_value = collection.get("max_backups", default_limit)
            try:
                limit_value = int(limit_value)
            except (TypeError, ValueError):
                limit_value = default_limit
            return enabled, limit_value

    return False, default_limit


def save_config(config):
    """Save configuration"""
    config_path = PROJECT_ROOT / "data" / "config.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def cli_backup(game_id: str):
    """Command-line backup for a specific game"""
    config = load_config()
    
    if not config.get("backup_directory"):
        print("ERROR: Backup directory not configured!")
        print("Please run GameVault GUI to configure settings first.")
        return 1
    
    games_db_path = PROJECT_ROOT / "data" / "games.json"
    detector = GameDetector(str(games_db_path))
    
    game = detector.get_game_by_id(game_id)
    if not game:
        print(f"ERROR: Game '{game_id}' not found in database!")
        return 1
    
    # Find the first valid save path
    save_path = None
    for path in game.get("save_paths", []):
        expanded = os.path.expandvars(path)
        if Path(expanded).exists():
            save_path = expanded
            break
    
    if not save_path:
        print(f"ERROR: Could not find save files for {game.get('name')}")
        return 1
    
    engine = BackupEngine(
        config["backup_directory"],
        max_backups=config.get("max_backups", 10)
    )
    
    print(f"Backing up: {game.get('name')}")
    print(f"From: {save_path}")
    print(f"To: {config['backup_directory']}")
    print()
    
    retention_enabled, retention_limit = get_collection_retention(config, game_id)
    result = engine.backup_game(
        game_id,
        game.get("name"),
        save_path,
        collection_id="default",
        retention_enabled=retention_enabled,
        retention_limit=retention_limit if retention_enabled else None,
    )
    
    if result["success"]:
        print(f"SUCCESS! Backup created: {result['backup_name']}")
        return 0
    else:
        print(f"ERROR: {result['error']}")
        return 1


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="GameVault - Game Save Backup Tool",
        prog="GameVault"
    )
    parser.add_argument(
        "--backup",
        metavar="GAME_ID",
        help="Backup a specific game by ID (CLI mode)"
    )
    parser.add_argument(
        "--list-games",
        action="store_true",
        help="List all available games"
    )
    
    args = parser.parse_args()
    
    # CLI mode: backup specific game
    if args.backup:
        sys.exit(cli_backup(args.backup))
    
    # CLI mode: list games
    if args.list_games:
        games_db_path = PROJECT_ROOT / "data" / "games.json"
        detector = GameDetector(str(games_db_path))
        print("\nAvailable games:")
        print("-" * 40)
        for game in detector.get_all_games():
            print(f"  {game.get('id'):25} - {game.get('name')}")
        print()
        sys.exit(0)
    
    # GUI mode
    try:
        import customtkinter
    except ImportError:
        print("CustomTkinter not found. Installing...")
        os.system(f"{sys.executable} -m pip install customtkinter pillow")
        import customtkinter
    
    from ui.main_window import GameVaultWindow
    
    app = GameVaultWindow()
    app.mainloop()


if __name__ == "__main__":
    main()
