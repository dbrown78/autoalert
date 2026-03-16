"""
conftest.py

Sets up sys.path so that tests can import from the three namespace-package
roots that make up the foresight-sim stack:
  - odin-writer  (core.connection, core.schema, writers.*, pipeline.*)
  - odin-injector (core.config, core.event, engine.*, curves.*)
  - odin-telemetry (core.vehicle, core.reading, core.specs, stream.*, profiles.*)
"""

import sys
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_FORESIGHT = os.path.dirname(_HERE)

_INJECTOR = os.path.join(_FORESIGHT, "odin-injector")
_TELEMETRY = os.path.join(_FORESIGHT, "odin-telemetry")

for p in (_TELEMETRY, _INJECTOR, _HERE):
    if p not in sys.path:
        sys.path.insert(0, p)
