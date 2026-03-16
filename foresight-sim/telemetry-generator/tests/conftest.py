"""
tests/conftest.py
Add the package root to sys.path so tests can import from core/, profiles/, stream/.
"""
import sys
from pathlib import Path

pkg_root = str(Path(__file__).parent.parent)
if pkg_root not in sys.path:
    sys.path.insert(0, pkg_root)
