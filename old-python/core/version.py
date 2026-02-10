"""
GameVault Version Info
"""

__version__ = "1.1.0"
__version_info__ = (1, 1, 0)

GITHUB_REPO = "Kawai-Senpai/GameVault"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def get_version() -> str:
    """Get current version string."""
    return __version__


def parse_version(version_str: str) -> tuple:
    """Parse a version string like 'v1.2.3' or '1.2.3' into tuple (1, 2, 3)."""
    version_str = version_str.lstrip("vV")
    parts = version_str.split(".")
    try:
        return tuple(int(p) for p in parts[:3])
    except (ValueError, TypeError):
        return (0, 0, 0)


def check_for_update() -> dict:
    """
    Check GitHub releases for a newer version.
    Returns dict with keys: has_update, latest_version, download_url, error
    """
    import urllib.request
    import json
    import ssl
    
    result = {
        "has_update": False,
        "latest_version": None,
        "download_url": None,
        "release_url": None,
        "error": None
    }
    
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(
            GITHUB_API_URL,
            headers={"User-Agent": "GameVault", "Accept": "application/vnd.github.v3+json"}
        )
        
        with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
            data = json.loads(response.read().decode("utf-8"))
        
        tag_name = data.get("tag_name", "")
        latest_version = parse_version(tag_name)
        current_version = __version_info__
        
        result["latest_version"] = tag_name
        result["release_url"] = data.get("html_url")
        
        # Find .exe download
        for asset in data.get("assets", []):
            if asset.get("name", "").endswith(".exe"):
                result["download_url"] = asset.get("browser_download_url")
                break
        
        result["has_update"] = latest_version > current_version
        
    except Exception as e:
        result["error"] = str(e)
    
    return result
