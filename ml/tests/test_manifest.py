import json
from datetime import date, datetime

import pandas as pd

from ml import evaluate
from ml.manifest import manifest_for, read_manifest, write_manifest


class TestWriteManifest:
    def test_writes_expected_keys(self, tmp_path):
        out = write_manifest(date(2026, 10, 4), path=tmp_path / "models" / "manifest.json")
        data = json.loads(out.read_text())
        assert set(data) == {"trained_through", "exported_at", "git_sha", "recipe"}
        assert data["trained_through"] == "2026-10-04"
        assert data["recipe"] == "A"
        datetime.fromisoformat(data["exported_at"])  # parses

    def test_accepts_timestamp(self, tmp_path):
        out = write_manifest(pd.Timestamp("2026-10-04"), recipe="B", path=tmp_path / "manifest.json")
        data = json.loads(out.read_text())
        assert data["trained_through"] == "2026-10-04"
        assert data["recipe"] == "B"


class TestManifestV2:
    def test_extra_fields_written(self, tmp_path):
        from ml.recipes import RECIPE_B

        fields = manifest_for(RECIPE_B, pd.DataFrame({"date_la": [date(2026, 5, 2), date(2026, 10, 15)]}), [30, 60])
        trained_through = fields.pop("trained_through")
        name = fields.pop("recipe")
        data = read_manifest(write_manifest(trained_through, recipe=name, path=tmp_path / "m.json", **fields))
        assert data["trained_through"] == "2026-10-15" and data["recipe"] == "B"
        assert data["trajectory_target"] == "delta"
        assert data["frame_range"] == ["2026-05-02", "2026-10-15"] and data["frame_rows"] == 2
        assert data["horizons"] == [30, 60]
        assert "week_of_year" not in data["trajectory_features"]


class TestReadManifest:
    def test_round_trip(self, tmp_path):
        path = write_manifest(date(2026, 10, 4), path=tmp_path / "manifest.json")
        assert read_manifest(path)["trained_through"] == "2026-10-04"

    def test_missing_file_is_none(self, tmp_path):
        assert read_manifest(tmp_path / "nope.json") is None

    def test_bad_json_is_none(self, tmp_path):
        (tmp_path / "manifest.json").write_text("{not json")
        assert read_manifest(tmp_path / "manifest.json") is None


class TestEvaluateUsesManifest:
    def _run(self, frame, model_dir, **kw):
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30],
                            run_staleness=False, write_report=False, model_dir=str(model_dir), **kw)

    def test_manifest_date_used_when_not_passed(self, frame, tmp_path):
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path)
        assert res.meta["deployed_trained_through"] == date(2026, 8, 10)
        assert res.meta["deployed_contaminated"] is False

    def test_explicit_date_wins_over_manifest(self, frame, tmp_path):
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path, deployed_trained_through=date(2026, 9, 30))
        assert res.meta["deployed_trained_through"] == date(2026, 9, 30)
        assert res.meta["deployed_contaminated"] is True

    def test_no_manifest_stays_unknown(self, frame, tmp_path):
        res = self._run(frame, tmp_path)
        assert res.meta["deployed_trained_through"] is None
        assert res.meta["deployed_contaminated"] is True

    def test_git_ref_ignores_working_tree_manifest(self, frame, tmp_path):
        # Unresolvable ref: deployed.* returns None for missing git objects.
        write_manifest(date(2026, 8, 10), path=tmp_path / "manifest.json")
        res = self._run(frame, tmp_path, deployed_git_ref="no-such-ref-xyz")
        assert res.meta["deployed_trained_through"] is None
        assert res.meta["deployed_contaminated"] is True


class TestManifestV3:
    THRESHOLDS = {b: {"call": {"rise": 0.4, "fall": 0.45}, "high": {"rise": 0.7, "fall": None}}
                  for b in ("<=10", "15-25", "30-60", ">60")}

    def _recipe(self):
        from ml.recipes import RECIPE_B, with_

        return with_(RECIPE_B, classifier_labels={"fall": ("flat", 5), "rise": ("pct", 0.4, 15)},
                     trend_thresholds=self.THRESHOLDS,
                     alert={"field": "p_rise_30", "threshold": 0.6, "min_current_wait": 10})

    def test_round_trip_through_json(self, tmp_path):
        from ml.manifest import recipe_from_manifest

        r = self._recipe()
        fields = manifest_for(r, pd.DataFrame({"date_la": [date(2026, 5, 2), date(2026, 10, 18)]}), [30, 60])
        trained_through = fields.pop("trained_through")
        name = fields.pop("recipe")
        data = read_manifest(write_manifest(trained_through, recipe=name, path=tmp_path / "m.json", **fields))
        assert data["classifiers"]["p_rise_30"]["label"] == ["pct", 0.4, 15]
        assert data["classifiers"]["p_fall_60"] == {"file": "clf_fall_60.txt", "horizon": 60,
                                                    "direction": "fall", "label": ["flat", 5]}
        assert data["trend_bands"][">60"] == [61, None]
        assert recipe_from_manifest(data) == r

    def test_v2_manifest_reads_as_no_classifiers(self):
        from ml.manifest import recipe_from_manifest

        v2 = {"trained_through": "2026-10-18", "recipe": "B", "trajectory_target": "delta",
              "reversion_exported": True}
        r = recipe_from_manifest(v2)
        assert not r.has_classifiers and r.trend_thresholds is None and r.alert is None

    def test_recipe_without_classifiers_writes_no_v3_fields(self):
        from ml.recipes import RECIPE_A

        fields = manifest_for(RECIPE_A, pd.DataFrame({"date_la": [date(2026, 10, 18)]}), [30])
        assert not {"classifiers", "trend_thresholds", "trend_bands", "alert"} & set(fields)
