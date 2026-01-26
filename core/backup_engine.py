"""
GameVault - Game Save Backup Tool
Core backup engine with rolling backup support, compression, and deduplication
"""

import os
import re
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

    def _sanitize_folder_name(self, name: str) -> str:
        """Create a filesystem-safe folder name from a game name."""
        name = (name or "").strip()
        if not name:
            return ""
        safe = re.sub(r"[^\w\s-]", "", name)
        safe = re.sub(r"\s+", " ", safe).strip()
        safe = safe.replace(" ", "_").strip("_-")
        return safe[:40]

    def _resolve_game_backup_dir(self, game_id: str, game_name: Optional[str]) -> Path:
        """Prefer a readable folder name but keep legacy folders working."""
        legacy_dir = self.backup_root / game_id
        safe_name = self._sanitize_folder_name(game_name or "")
        preferred_dir = self.backup_root / f"{safe_name}__{game_id}" if safe_name else legacy_dir

        if preferred_dir.exists():
            return preferred_dir

        if legacy_dir.exists() and preferred_dir != legacy_dir:
            try:
                legacy_dir.rename(preferred_dir)
                return preferred_dir
            except Exception:
                return legacy_dir

        preferred_dir.mkdir(parents=True, exist_ok=True)
        return preferred_dir

    def _find_game_backup_dirs(self, game_id: str) -> List[Path]:
        """Find all backup folders that belong to a game id."""
        dirs = []
        legacy_dir = self.backup_root / game_id
        if legacy_dir.exists():
            dirs.append(legacy_dir)
        for candidate in self.backup_root.glob(f"*__{game_id}"):
            if candidate.is_dir() and candidate not in dirs:
                dirs.append(candidate)
        return dirs
    
    def backup_game(
        self,
        game_id: str,
        game_name: str,
        save_path: str,
        force: bool = False,
        display_name: Optional[str] = None,
        collection_id: str = "default",
        retention_enabled: bool = False,
        retention_limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Create a compressed backup of a game's save files with deduplication.
        
        Args:
            game_id: Unique identifier for the game
            game_name: Display name of the game
            save_path: Path to the save files
            force: Force backup even if content is unchanged
            display_name: Optional display name for the backup
            collection_id: Optional collection identifier
            retention_enabled: Whether to enforce retention for this collection
            retention_limit: Max backups to keep for the collection (if enabled)
            
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
        game_backup_dir = self._resolve_game_backup_dir(game_id, game_name)
        
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
            display_name = (display_name or "").strip()
            if not collection_id:
                collection_id = "default"

            # Create metadata
            metadata = {
                "game_id": game_id,
                "game_name": game_name,
                "source_path": str(save_path),
                "backup_time": datetime.now().isoformat(),
                "backup_name": backup_name,
                "display_name": display_name,
                "collection_id": collection_id,
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
            self._apply_rolling_limit(
                game_backup_dir,
                collection_id=collection_id,
                retention_enabled=retention_enabled,
                retention_limit=retention_limit,
            )
            
            return {
                "success": True,
                "error": None,
                "backup_path": str(zip_path),
                "backup_name": backup_name,
                "timestamp": timestamp,
                "display_name": display_name,
                "collection_id": collection_id,
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
    
    def _get_backup_collection_id(self, backup_path: Path) -> str:
        """Read the collection id from a backup's metadata."""
        metadata = None
        if backup_path.suffix == ".zip":
            metadata = self._read_metadata_from_zip(backup_path)
        elif backup_path.is_dir():
            metadata_path = backup_path / "_backup_info.json"
            if metadata_path.exists():
                try:
                    with open(metadata_path, "r", encoding="utf-8") as f:
                        metadata = json.load(f)
                except Exception:
                    metadata = None
        return (metadata or {}).get("collection_id") or "default"

    def _apply_rolling_limit(
        self,
        game_backup_dir: Path,
        *,
        collection_id: str,
        retention_enabled: bool = False,
        retention_limit: Optional[int] = None,
    ):
        """Delete oldest backups if we exceed the collection-specific limit."""

        if not retention_enabled:
            return

        if retention_limit is None:
            retention_limit = self.max_backups

        try:
            retention_limit = int(retention_limit)
        except (TypeError, ValueError):
            return

        if retention_limit <= 0:
            return

        # Get all backup files/folders
        backups = [
            item for item in game_backup_dir.iterdir()
            if (item.is_dir() and not item.name.startswith(".")) or item.suffix == ".zip"
        ]

        target_collection = collection_id or "default"
        collection_backups = [
            item for item in backups
            if self._get_backup_collection_id(item) == target_collection
        ]

        # Sort by modification time (oldest first)
        collection_backups.sort(key=lambda x: x.stat().st_mtime)

        # Delete oldest backups if we exceed limit
        while len(collection_backups) > retention_limit:
            oldest = collection_backups.pop(0)
            try:
                if oldest.is_dir():
                    shutil.rmtree(oldest)
                else:
                    oldest.unlink()
            except Exception:
                pass  # Ignore deletion errors
    
    def get_backups(self, game_id: str) -> List[Dict[str, Any]]:
        """Get list of backups for a game"""
        
        game_backup_dirs = self._find_game_backup_dirs(game_id)
        if not game_backup_dirs:
            return []
        
        backups = []
        
        for game_backup_dir in game_backup_dirs:
            for item in sorted(game_backup_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                metadata = None
                item_stat = item.stat()
                
                if item.suffix == '.zip':
                    # Read from zip
                    metadata = self._read_metadata_from_zip(item)
                    if metadata:
                        metadata.setdefault("display_name", "")
                        metadata.setdefault("collection_id", "default")
                        metadata["path"] = str(item)
                        metadata["size"] = item_stat.st_size
                        metadata["is_compressed"] = True
                        metadata["_sort_mtime"] = item_stat.st_mtime
                        backups.append(metadata)
                
                elif item.is_dir():
                    # Read from folder
                    metadata_path = item / "_backup_info.json"
                    if metadata_path.exists():
                        try:
                            with open(metadata_path, "r", encoding="utf-8") as f:
                                metadata = json.load(f)
                            metadata.setdefault("display_name", "")
                            metadata.setdefault("collection_id", "default")
                            metadata["path"] = str(item)
                            metadata["size"] = self._get_folder_size(item)
                            metadata["is_compressed"] = False
                            metadata["_sort_mtime"] = item_stat.st_mtime
                            backups.append(metadata)
                        except Exception:
                            pass
        
        backups.sort(key=lambda x: x.get("_sort_mtime", 0), reverse=True)
        for backup in backups:
            backup.pop("_sort_mtime", None)
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

    def rename_backup(
        self,
        backup_path: str,
        display_name: str,
        collection_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Update backup display name and/or collection metadata."""
        backup_path = Path(backup_path)
        if not backup_path.exists():
            return {
                "success": False,
                "error": "Backup does not exist"
            }

        display_name = (display_name or "").strip()

        if backup_path.suffix == ".zip":
            metadata = self._read_metadata_from_zip(backup_path) or {}
            metadata.setdefault("backup_name", backup_path.stem)
            metadata.setdefault("backup_time", datetime.now().isoformat())
            metadata["display_name"] = display_name
            if collection_id is not None:
                metadata["collection_id"] = collection_id or "default"

            tmp_path = backup_path.with_name(backup_path.name + ".tmp")
            try:
                with zipfile.ZipFile(backup_path, "r") as src, zipfile.ZipFile(
                    tmp_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9
                ) as dst:
                    for item in src.infolist():
                        if item.filename == "_backup_info.json":
                            continue
                        dst.writestr(item, src.read(item.filename))
                    dst.writestr("_backup_info.json", json.dumps(metadata, indent=2))
                tmp_path.replace(backup_path)
                return {"success": True, "error": None}
            except Exception as e:
                if tmp_path.exists():
                    tmp_path.unlink()
                return {"success": False, "error": str(e)}

        metadata_path = backup_path / "_backup_info.json"
        metadata = {}
        if metadata_path.exists():
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            except Exception:
                metadata = {}
        metadata["display_name"] = display_name
        if collection_id is not None:
            metadata["collection_id"] = collection_id or "default"

        try:
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            return {"success": True, "error": None}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
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
