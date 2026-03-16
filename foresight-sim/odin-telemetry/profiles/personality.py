"""
profiles/personality.py

Per-vehicle personality offsets give each simulated vehicle a consistent
character that persists across the entire simulation.

Real vehicles have permanent quirks:
  - Vehicle A always runs 3°C hotter than spec (slightly scaled thermostat)
  - Vehicle B has a lazy upstream O2 (sluggish voltage transitions)
  - Vehicle C idles 80 RPM high (slight idle relearn needed)

Without personality, all vehicles of the same archetype look identical
after noise averaging — making the community baseline meaningless.
With personality, each vehicle has a unique fingerprint, exactly like
real-world OBD-II data.

Personality is generated ONCE at VehicleProfile creation time (seeded)
and never changes. This makes the generator deterministic.

Architecture:
  PersonalityProfile holds per-sensor bias and noise_scale_factor.
  bias:              Added to every reading from this sensor (positive or negative)
  noise_scale:       Multiplier on the sensor's spec.noise_std (>1 = noisier vehicle)

Bias magnitude is bounded as a fraction of the sensor's healthy range width
so personality never pushes healthy values into degradation territory.
"""

from dataclasses import dataclass, field
from typing import Dict
import numpy as np

from core.specs import SENSOR_REGISTRY, SensorSpec


# What fraction of healthy_range width can bias span (±)
# e.g. 0.08 = bias can shift readings up to ±8% of healthy range
BIAS_SCALE = 0.08

# Noise scale range — how much noisier/quieter a vehicle can be vs spec
NOISE_SCALE_RANGE = (0.7, 1.5)


@dataclass(frozen=True)
class SensorPersonality:
    sensor_name: str
    bias: float           # Permanent additive offset (can be negative)
    noise_scale: float    # Multiplier on spec.noise_std


@dataclass(frozen=True)
class PersonalityProfile:
    vehicle_id: str
    sensors: Dict[str, SensorPersonality]

    def get(self, sensor_name: str) -> SensorPersonality:
        if sensor_name not in self.sensors:
            # Return neutral personality for any sensor not in registry
            return SensorPersonality(sensor_name=sensor_name, bias=0.0, noise_scale=1.0)
        return self.sensors[sensor_name]

    def bias_for(self, sensor_name: str) -> float:
        return self.get(sensor_name).bias

    def noise_scale_for(self, sensor_name: str) -> float:
        return self.get(sensor_name).noise_scale

    def summary(self) -> str:
        lines = [f"Personality: {self.vehicle_id}"]
        for name, p in self.sensors.items():
            lines.append(f"  {name:<25}  bias={p.bias:+.4f}  noise_scale={p.noise_scale:.2f}")
        return "\n".join(lines)


def generate_personality(vehicle_id: str, seed: int, health: float) -> PersonalityProfile:
    """
    Generate a PersonalityProfile for a vehicle.
    
    seed:   From VehicleProfile.seed — ensures same vehicle = same personality
    health: From VehicleProfile.base_health — lower health = larger biases,
            noisier readings (worn vehicles are less consistent)
    """
    rng = np.random.default_rng(seed)

    # Lower health → larger personality extremes
    health_factor = 1.0 + (1.0 - health) * 1.5  # ranges from 1.0 (perfect) to 2.5 (junker)

    sensor_personalities = {}

    for name, spec in SENSOR_REGISTRY.items():
        # Bias magnitude: fraction of healthy range width, scaled by health
        range_width = spec.healthy_max - spec.healthy_min
        max_bias = range_width * BIAS_SCALE * health_factor
        bias = float(rng.uniform(-max_bias, max_bias))

        # Noise scale: how much noisier than spec this vehicle is
        noise_lo = NOISE_SCALE_RANGE[0]
        noise_hi = NOISE_SCALE_RANGE[1] * health_factor
        noise_scale = float(np.clip(rng.uniform(noise_lo, noise_hi), 0.5, 3.0))

        sensor_personalities[name] = SensorPersonality(
            sensor_name=name,
            bias=round(bias, 6),
            noise_scale=round(noise_scale, 4),
        )

    return PersonalityProfile(vehicle_id=vehicle_id, sensors=sensor_personalities)
