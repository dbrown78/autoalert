"""
conftest.py
Pytest configuration — wires up the 'sim' module namespace so that the
source files' internal 'from sim.xxx import ...' imports resolve correctly
when running tests from the odin-sim/ directory.
"""

import sys
import types
import importlib
from pathlib import Path

# Ensure odin-sim/ is on the path so bare imports like 'import sensors' work
odin_sim_dir = Path(__file__).parent
if str(odin_sim_dir) not in sys.path:
    sys.path.insert(0, str(odin_sim_dir))

# Create a 'sim' package namespace pointing at this directory
sim_mod = types.ModuleType("sim")
sim_mod.__path__ = [str(odin_sim_dir)]
sim_mod.__package__ = "sim"
sys.modules["sim"] = sim_mod

# Bootstrap submodules in dependency order so cross-imports resolve
# Only wire up modules needed by tests (db/bootstrap require psycopg2 / DB connection)
_submodules = ["sensors", "degradation", "generator", "injector"]
for _name in _submodules:
    _mod = importlib.import_module(_name)
    sys.modules[f"sim.{_name}"] = _mod
    setattr(sim_mod, _name, _mod)
