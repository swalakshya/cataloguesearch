"""
Common utility functions shared across the backend modules.
"""

import os
import json
import logging

log_handle = logging.getLogger(__name__)

# Maps the raw "Pravachankar" value stored in metadata (config.json's Pravachankar
# field) to the honorific display string per language. Add an entry here whenever
# a new Pravachankar is onboarded.
PRAVACHANKAR_HONORIFICS = {
    "Gurudev Kanji Swami": {
        "gu": "પૂજ્ય ગુરુદેવશ્રી કાનજી સ્વામી, સોનગઢ",
        "hi": "पूज्य गुरुदेव श्री कानजी स्वामी, सोनगढ़",
    },
    "Bahinshree Champaben": {
        "gu": "પૂજ્ય બહેનશ્રી ચંપાબેન",
        "hi": "पूज्य बहिनश्री चम्पाबेन",
    },
}


def get_pravachankar_display(pravachankar: str, language: str) -> str:
    """
    Returns the honorific display string for a Pravachankar in the given language,
    falling back to the raw metadata value when the Pravachankar isn't in
    PRAVACHANKAR_HONORIFICS yet.
    """
    lang_key = "gu" if language in ("gujarati", "gu") else "hi"
    honorifics = PRAVACHANKAR_HONORIFICS.get(pravachankar)
    return honorifics[lang_key] if honorifics else pravachankar


def _collect_folders(directory: str, base_folder: str) -> list:
    """Collects all folders from base_folder down to (and including) directory."""
    directory = os.path.abspath(directory)
    base_folder = os.path.abspath(base_folder)

    folders = []
    current = directory

    while True:
        folders = [current] + folders
        log_handle.debug(f"Current folder: {current}, Base folder: {base_folder}")

        try:
            if os.path.samefile(current, base_folder):
                break
        except (OSError, FileNotFoundError):
            # If samefile fails, fall back to string comparison
            if os.path.normpath(current) == os.path.normpath(base_folder):
                break

        parent = os.path.dirname(current)
        if parent == current:  # Reached filesystem root
            break
        current = parent

    return folders


def _merge_folder_configs(folders: list) -> dict:
    """Merges config.json from each of the given folders, in order, into one dict."""
    config = {}
    for folder in folders:
        config_path = os.path.join(folder, "config.json")
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    folder_config = json.load(f)
                    config.update(folder_config)
                    log_handle.debug(f"Loaded config from {config_path}")
            except (json.JSONDecodeError, IOError) as e:
                log_handle.warning(f"Could not read or parse {config_path}: {e}")
    return config


def get_merged_config(file_path: str, base_folder: str) -> dict:
    """
    Loads hierarchical configuration for a file by merging config.json files
    from base folder up to the file's directory, plus file-specific config.

    Args:
        file_path: Path to the file to load config for
        base_folder: Base folder to start hierarchy from

    Returns:
        Merged configuration dictionary
    """
    file_path = os.path.abspath(file_path)
    base_folder = os.path.abspath(base_folder)

    config = _merge_folder_configs(_collect_folders(os.path.dirname(file_path), base_folder))

    # Merge file-specific config
    file_base, _ = os.path.splitext(file_path)
    file_config_path = f"{file_base}_config.json"
    if os.path.exists(file_config_path):
        try:
            with open(file_config_path, "r", encoding="utf-8") as f:
                file_config = json.load(f)
                config.update(file_config)
                log_handle.debug(f"Loaded file-specific config from {file_config_path}")
        except (json.JSONDecodeError, IOError) as e:
            log_handle.warning(f"Could not read or parse {file_config_path}: {e}")

    return config


def get_merged_config_for_dir(directory: str, base_folder: str) -> dict:
    """
    Loads hierarchical configuration for a directory itself (no file-specific
    overrides), by merging config.json files from base_folder down to directory
    inclusive.

    Used by callers that reason about series/Granth folders directly rather than
    individual PDF files (e.g. the content catalogue index rebuild).

    Args:
        directory: Directory to load config for
        base_folder: Base folder to start hierarchy from

    Returns:
        Merged configuration dictionary
    """
    return _merge_folder_configs(_collect_folders(directory, base_folder))


def list_directories(root: str) -> list:
    """
    Recursively lists all directories under root (root included), skipping any
    directory that contains an '_ignore' file (and its whole subtree) and
    dot-directories.

    Shared by Discovery's crawl-directory enumeration and the catalogue index
    rebuild, both of which need every folder in the tree regardless of whether
    it contains PDFs.

    Args:
        root: Directory to start the walk from

    Returns:
        List of directory paths, root first, in depth-first order.
    """
    directories = []

    def _recurse(directory_path):
        if os.path.exists(os.path.join(directory_path, "_ignore")):
            log_handle.info(f"Ignoring directory {directory_path} due to _ignore file")
            return
        directories.append(directory_path)
        try:
            for item in sorted(os.listdir(directory_path)):
                if item.startswith('.'):
                    continue
                item_path = os.path.join(directory_path, item)
                if os.path.isdir(item_path):
                    _recurse(item_path)
        except (OSError, PermissionError) as e:
            log_handle.warning(f"Cannot access directory {directory_path}: {e}")

    _recurse(root)
    return directories