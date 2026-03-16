"""tests/test_splitter.py — Unit tests for vehicle-level data splitting."""


class TestSplitter:
    def test_no_vehicle_overlap(self, split_df):
        from data.splitter import vehicle_level_split
        train, val, test = vehicle_level_split(split_df)
        train_ids = set(train["vehicle_id"])
        val_ids   = set(val["vehicle_id"])
        test_ids  = set(test["vehicle_id"])
        assert train_ids.isdisjoint(val_ids),  "Vehicle appears in both train and val"
        assert train_ids.isdisjoint(test_ids), "Vehicle appears in both train and test"
        assert val_ids.isdisjoint(test_ids),   "Vehicle appears in both val and test"

    def test_all_vehicles_covered(self, split_df):
        from data.splitter import vehicle_level_split
        train, val, test = vehicle_level_split(split_df)
        all_vehicles = set(split_df["vehicle_id"])
        covered = set(train["vehicle_id"]) | set(val["vehicle_id"]) | set(test["vehicle_id"])
        assert all_vehicles == covered, "Some vehicles missing from split"

    def test_reproducible_split(self, split_df):
        from data.splitter import vehicle_level_split
        train_a, _, _ = vehicle_level_split(split_df, seed=7)
        train_b, _, _ = vehicle_level_split(split_df, seed=7)
        assert set(train_a["vehicle_id"]) == set(train_b["vehicle_id"])
