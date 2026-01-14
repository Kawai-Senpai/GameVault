"""
GameVault - Game Save Backup Tool
Core backup engine with rolling backup support, compression, and deduplication
"""

import os
import shutil
import json
import hashlib
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any


class BackupEngine:
    """Handles backup operations with rolling backup support, compression, and deduplication"""
    
    def __init__(self, backup_root: str, max_backups: int = 10):
        self.backup_root = Path(backup_root)
        self.max_backups = max_backups
        
        # Create backup directory if it doesn't exist
        self.backup_root.mkdir(parents=True, exist_ok=True)
    
    def _compute_folder_hash(self, folder_path: Path) -> str:
        """
        Compute a hash of the entire folder contents (like git tree hash).
        This is used for deduplication - if hash is same, skip backup.
        """
        hasher = hashlib.sha256()
        
        # Get all files sorted by relative path for consistent hashing
        all_files = sorted(folder_path.rglob("*"), key=lambda x: str(x.relative_to(folder_path)))
        
        for file_path in all_files:
            if file_path.is_file():
                # Add relative path to hash
                rel_path = str(file_path.relative_to(folder_path))
                hasher.update(rel_path.encode('utf-8'))
                
                # Add file content hash
                try:
                    with open(file_path, 'rb') as f:
                        while chunk := f.read(65536):  # 64KB chunks
                            hasher.update(chunk)
                except Exception:
                    pass  # Skip unreadable files
        
        return hasher.hexdigest()[:16]  # Short hash is enough for dedup
    
    def _get_latest_backup_hash(self, game_backup_dir: Path) -> Optional[str]:
        """Get the hash of the most recent backup for comparison"""
        if not game_backup_dir.exists():
            return None
        
        backups = sorted(
            [d for d in game_backup_dir.iterdir() if d.is_dir() or d.suffix == '.zip'],
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        if not backups:
            return None
        
        latest = backups[0]
        
        # Check for zip file
        if latest.suffix == '.zip':
            metadata_in_zip = self._read_metadata_from_zip(latest)
            if metadata_in_zip:
                return metadata_in_zip.get("content_hash")
        else:
            # Check for metadata file in folder
            metadata_path = latest / "_backup_info.json"
            if metadata_path.exists():
                try:
                    with open(metadata_path, "r", encoding="utf-8") as f:
                        metadata = json.load(f)
                    return metadata.get("content_hash")
                except Exception:
                    pass
        
        return None
    
    def _read_metadata_from_zip(self, zip_path: Path) -> Optional[Dict[str, Any]]:
        """Read metadata from inside a zip backup"""
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                if "_backup_info.json" in zf.namelist():
                    with zf.open("_backup_info.json") as f:
                        return json.load(f)
        except Exception:
            pass
        return None
    
    def backup_game(self, game_id: str, game_name: str, save_path: str, force: bool = False) -> Dict[str, Any]:
        """
        Create a compressed backup of a game's save files with deduplication.
        
        Args:
            game_id: Unique identifier for the game
            game_name: Display name of the game
            save_path: Path to the save files
            force: Force backup even if content is unchanged
            
        Returns:
            Dict with backup status and info
        """
        save_path = Path(os.path.expandvars(save_path))
        
        if not save_path.exists():
            return {
                "success": False,
                "error": f"Save path does not exist: {save_path}",
                "backup_path": None,
                "skipped": False
            }
        
        # Create game backup directory
        game_backup_dir = self.backup_root / game_id
        game_backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Compute content hash for deduplication
        current_hash = self._compute_folder_hash(save_path)
        
        # Check if we already have this exact backup (deduplication)
        if not force:
            latest_hash = self._get_latest_backup_hash(game_backup_dir)
            if latest_hash and latest_hash == current_hash:
                return {
                    "success": True,
                    "error": None,
                    "backup_path": None,
                    "backup_name": None,
                    "skipped": True,
                    "message": "No changes detected - backup skipped (identical to latest)"
                }
        
        # Create timestamped backup
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"{game_id}_{timestamp}"
        zip_path = game_backup_dir / f"{backup_name}.zip"
        
        try:
            # Create metadata
            metadata = {
                "game_id": game_id,
                "game_name": game_name,
                "source_path": str(save_path),
                "backup_time": datetime.now().isoformat(),
                "backup_name": backup_name,
                "content_hash": current_hash,
                "compression": "zip"
            }
            
            # Create compressed backup
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
                # Add all files from save folder
                for file_path in save_path.rglob("*"):
                    if file_path.is_file():
                        arcname = file_path.relative_to(save_path)
                        zf.write(file_path, arcname)
                
                # Add metadata inside the zip
                zf.writestr("_backup_info.json", json.dumps(metadata, indent=2))
            
            # Get compressed size
            compressed_size = zip_path.stat().st_size
            
            # Apply rolling backup limit
            self._apply_rolling_limit(game_backup_dir)
            
            return {
                "success": True,
                "error": None,
                "backup_path": str(zip_path),
                "backup_name": backup_name,
                "timestamp": timestamp,
                "content_hash": current_hash,
                "compressed_size": compressed_size,
                "skipped": False
            }
            
        except Exception as e:
            # Clean up failed backup
            if zip_path.exists():
                zip_path.unlink()
            
            return {
                "success": False,
                "error": str(e),
                "backup_path": None,
                "skipped": False
            }
    
    def _apply_rolling_limit(self, game_backup_dir: Path):
        """Delete oldest backups if we exceed the max limit"""
        
        # Get all backup files/folders
        backups = [
            item for item in game_backup_dir.iterdir() 
            if (item.is_dir() and not item.name.startswith(".")) or item.suffix == '.zip'
        ]
        
        # Sort by modification time (oldest first)
        backups.sort(key=lambda x: x.stat().st_mtime)
        
        # Delete oldest backups if we exceed limit
        while len(backups) > self.max_backups:
            oldest = backups.pop(0)
            try:
                if oldest.is_dir():
                    shutil.rmtree(oldest)
                else:
                    oldest.unlink()
            except Exception:
                pass  # Ignore deletion errors
    
    def get_backups(self, game_id: str) -> List[Dict[str, Any]]:
        """Get list of backups for a game"""
        
        game_backup_dir = self.backup_root / game_id
        if not game_backup_dir.exists():
            return []
        
        backups = []
        
        for item in sorted(game_backup_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            metadata = None
            
            if item.suffix == '.zip':
                # Read from zip
                metadata = self._read_metadata_from_zip(item)
                if metadata:
                    metadata["path"] = str(item)
                    metadata["size"] = item.stat().st_size
                    metadata["is_compressed"] = True
                    backups.append(metadata)
            
            elif item.is_dir():
                # Read from folder
                metadata_path = item / "_backup_info.json"
                if metadata_path.exists():
                    try:
                        with open(metadata_path, "r", encoding="utf-8") as f:
                            metadata = json.load(f)
                        metadata["path"] = str(item)
                        metadata["size"] = self._get_folder_size(item)
                        metadata["is_compressed"] = False
                        backups.append(metadata)
                    except Exception:
                        pass
        
        return backups
    
    def restore_backup(self, backup_path: str, target_path: str) -> Dict[str, Any]:
        """
        Restore a backup to the original save location
        
        Args:
            backup_path: Path to the backup (zip file or folder)
            target_path: Where to restore (original save location)
            
        Returns:
            Dict with restore status
        """
        backup_path = Path(backup_path)
        target_path = Path(os.path.expandvars(target_path))
        
        if not backup_path.exists():
            return {
                "success": False,
                "error": f"Backup does not exist: {backup_path}"
            }
        
        try:
            # Create a safety backup of current saves before restoring
            if target_path.exists():
                safety_backup = target_path.parent / f"{target_path.name}_pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                shutil.copytree(target_path, safety_backup)
                shutil.rmtree(target_path)
            
            # Ensure target directory exists
            target_path.mkdir(parents=True, exist_ok=True)
            
            if backup_path.suffix == '.zip':
                # Extract from zip
                with zipfile.ZipFile(backup_path, 'r') as zf:
                    for member in zf.namelist():
                        # Skip metadata file
                        if member == "_backup_info.json":
                            continue
                        zf.extract(member, target_path)
            else:
                # Copy from folder (excluding metadata file)
                for item in backup_path.iterdir():
                    if item.name == "_backup_info.json":
                        continue
                    
                    dest = target_path / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest)
                    else:
                        shutil.copy2(item, dest)
            
            return {
                "success": True,
                "error": None,
                "restored_to": str(target_path)
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def delete_backup(self, backup_path: str) -> Dict[str, Any]:
        """Delete a specific backup"""
        
        backup_path = Path(backup_path)
        if not backup_path.exists():
            return {
                "success": False,
                "error": "Backup does not exist"
            }
        
        try:
            if backup_path.is_dir():
                shutil.rmtree(backup_path)
            else:
                backup_path.unlink()
            return {"success": True, "error": None}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_folder_size(self, path: Path) -> int:
        """Get total size of a folder in bytes"""
        total = 0
        try:
            for entry in path.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
        except Exception:
            pass
        return total
    
    @staticmethod
    def format_size(size_bytes: int) -> str:
        """Format bytes to human readable string"""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"
