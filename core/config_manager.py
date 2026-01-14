"""
GameVault - Configuration Manager
Handles loading and saving user configuration.
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional

# Default config
DEFAULT_CONFIG = {
    "backup_directory": "",
    "max_backups": 10,
    "user_games": [],
    "theme": "dark",
    "first_run": True
}


class ConfigManager:
    """Manages GameVault configuration."""
    
    def __init__(self, config_dir: Optional[Path] = None):
        """Initialize config manager.
        
        Args:
            config_dir: Directory to store config. Defaults to user's AppData.
        """
        if config_dir:
            self.config_dir = Path(config_dir)
        else:
            # Use AppData/Local/GameVault
            appdata = Path.home() / "AppData" / "Local" / "GameVault"
            self.config_dir = appdata
        
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.config_dir / "config.json"
    
    def load_config(self) -> Dict[str, Any]:
        """Load configuration from disk.
        
        Returns:
            Configuration dictionary with defaults filled in.
        """
        config = DEFAULT_CONFIG.copy()
        
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    config.update(saved)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load config: {e}")
        
        return config
    
    def save_config(self, config: Dict[str, Any]) -> bool:
        """Save configuration to disk.
        
        Args:
            config: Configuration dictionary to save.
            
        Returns:
            True if saved successfully.
        """
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            return True
        except IOError as e:
            print(f"Error saving config: {e}")
            return False
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a config value.
        
        Args:
            key: Config key to get.
            default: Default value if key not found.
            
        Returns:
            Config value or default.
        """
        config = self.load_config()
        return config.get(key, default)
    
    def set(self, key: str, value: Any) -> bool:
        """Set a config value.
        
        Args:
            key: Config key to set.
            value: Value to set.
            
        Returns:
            True if saved successfully.
        """
        config = self.load_config()
        config[key] = value
        return self.save_config(config)
    
    def reset(self) -> bool:
        """Reset config to defaults.
        
        Returns:
            True if saved successfully.
        """
        return self.save_config(DEFAULT_CONFIG.copy())
