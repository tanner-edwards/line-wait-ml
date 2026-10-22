import json

import lightgbm as lgb
import pytest

from ml import export as export_mod
from ml.export import HORIZONS, export, train_all
from ml.manifest import read_manifest, recipe_from_manifest
from ml.recipes import RECIPE_A, RECIPE_B, with_

TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
TINY_CLF = dict(n_estimators=5, num_leaves=7, learning_rate=0.1, verbose=-1)
THRESHOLDS = {b: {"call": {"rise": 0.5, "fall": 0.5}, "high": {"rise": 0.8, "fall": None}}
              for b in ("<=10", "15-25", "30-60", ">60")}
ALERT = {"field": "p_rise_30", "threshold": 0.6, "min_current_wait": 10}
TINY_B = with_(RECIPE_B, trajectory_params=TINY, day_profile_params=TINY, classifier_params=TINY_CLF,
               classifier_labels={"fall": ("flat", 5), "rise": ("flat", 5)},
               trend_thresholds=THRESHOLDS, alert=ALERT)
CLF_FILES = {"clf_fall_30.txt", "clf_fall_60.txt", "clf_rise_30.txt", "clf_rise_60.txt"}


@pytest.fixture(scope="module")
def frame_with_park(frame):
    out = frame.copy()
    out["park_id"] = out["park_name"].map({"Park A": "park-a", "Park B": "park-b"})
    return out


@pytest.fixture(scope="module")
def models(frame_with_park):
    from ml.tests.conftest import RIDE_CATS, STATUS_CATS

    return train_all(frame_with_park, TINY_B, RIDE_CATS, STATUS_CATS)


def _export(models, df, out_dir, **kw):
    from ml.tests.conftest import RIDE_CATS, STATUS_CATS

    return export(models, df, TINY_B, RIDE_CATS, STATUS_CATS, out_dir=out_dir, **kw)


class TestTrainAll:
    def test_twelve_plus_one(self, models):
        assert sorted(models["trajectory"]) == HORIZONS
        assert models["day_profile"] is not None
        assert models["rows"]["day_profile"] > 0

    def test_fit_on_every_valid_row(self, models, frame_with_park):
        assert models["rows"]["trajectory_t60"] == int(frame_with_park["training_valid_t60"].sum())
        assert models["trajectory"][60].recipe_ == TINY_B

    def test_four_classifiers(self, models, frame_with_park):
        assert sorted(models["classifiers"]) == ["p_fall_30", "p_fall_60", "p_rise_30", "p_rise_60"]
        assert models["classifiers"]["p_rise_60"].recipe_ == TINY_B
        assert models["classifiers"]["p_rise_60"].horizon_ == 60
        assert models["rows"]["p_fall_30"] == int(frame_with_park["training_valid_t30"].sum())

    def test_recipe_without_classifiers_trains_none(self, frame_with_park):
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        no_clf = with_(TINY_B, classifier_labels=None)
        assert train_all(frame_with_park, no_clf, RIDE_CATS, STATUS_CATS, horizons=[30])["classifiers"] == {}


class TestExport:
    def test_writes_every_file_and_v3_manifest(self, models, frame_with_park, tmp_path):
        manifest = _export(models, frame_with_park, tmp_path / "models")
        names = {p.name for p in (tmp_path / "models").iterdir()}
        expected = {f"trajectory_t{h}.txt" for h in HORIZONS} | CLF_FILES | {
            "day_profile.txt", "feature_categories.json", "ride_regime_thresholds.json",
            "crowd_level_baselines.json", "manifest.json"}
        assert names == expected
        assert len(names) == 21  # 12 trajectory + day_profile + 4 clf + 4 JSON
        on_disk = read_manifest(tmp_path / "models" / "manifest.json")
        assert on_disk == manifest
        assert manifest["recipe"] == "B" and manifest["trajectory_target"] == "delta"
        assert manifest["trajectory_features"] == list(RECIPE_B.trajectory_features)
        assert manifest["day_profile_features"] == list(RECIPE_B.day_profile_features)
        assert manifest["horizons"] == HORIZONS
        assert manifest["trained_through"] == str(frame_with_park["date_la"].max())
        assert manifest["frame_rows"] == len(frame_with_park)
        assert manifest["frame_range"] == [str(frame_with_park["date_la"].min()), manifest["trained_through"]]
        assert "reversion_exported" not in manifest
        assert manifest["classifiers"]["p_rise_30"] == {
            "file": "clf_rise_30.txt", "horizon": 30, "direction": "rise", "label": ["flat", 5]}
        assert {c["file"] for c in manifest["classifiers"].values()} == CLF_FILES
        assert manifest["trend_thresholds"] == THRESHOLDS and manifest["alert"] == ALERT
        assert recipe_from_manifest(manifest) == with_(TINY_B, trajectory_params=RECIPE_B.trajectory_params,
                                                        day_profile_params=RECIPE_B.day_profile_params,
                                                        classifier_params=RECIPE_B.classifier_params)
        clf = lgb.Booster(model_file=str(tmp_path / "models" / "clf_rise_30.txt"))
        assert clf.feature_name() == list(RECIPE_B.trajectory_features)
        booster = lgb.Booster(model_file=str(tmp_path / "models" / "trajectory_t60.txt"))
        assert booster.feature_name() == list(RECIPE_B.trajectory_features)
        cats = json.loads((tmp_path / "models" / "feature_categories.json").read_text())
        assert set(cats) == {"ride_id_categories", "status_categories"}
        assert not list(tmp_path.glob(".export-*"))  # temp dir cleaned up

    def test_stale_reversion_files_removed(self, models, frame_with_park, tmp_path):
        out = tmp_path / "models"
        out.mkdir()
        (out / "reversion_model.txt").write_text("old reversion")
        (out / "ride_percentile_buckets.json").write_text("{}")
        (out / "morning_baselines.json").write_text("{}")  # unrelated files stay
        _export(models, frame_with_park, out)
        assert not (out / "reversion_model.txt").exists()
        assert not (out / "ride_percentile_buckets.json").exists()
        assert (out / "morning_baselines.json").exists()
        assert CLF_FILES <= {p.name for p in out.iterdir()}

    def test_refuses_missing_classifiers(self, models, frame_with_park, tmp_path):
        partial = {**models, "classifiers": {k: v for k, v in models["classifiers"].items() if k != "p_rise_60"}}
        with pytest.raises(ValueError):
            _export(partial, frame_with_park, tmp_path / "models")
        assert not (tmp_path / "models").exists() or not list((tmp_path / "models").iterdir())

    def test_failure_leaves_out_dir_untouched(self, models, frame_with_park, tmp_path, monkeypatch):
        out = tmp_path / "models"
        out.mkdir()
        (out / "sentinel.txt").write_text("keep me")
        (out / "trajectory_t60.txt").write_text("old model")
        (out / "reversion_model.txt").write_text("old reversion")

        def boom(*a, **k):
            raise RuntimeError("thresholds failed")

        monkeypatch.setattr(export_mod.crowd_features, "regime_thresholds", boom)
        with pytest.raises(RuntimeError):
            _export(models, frame_with_park, out)
        # A failed export deletes nothing, stale reversion files included.
        assert sorted(p.name for p in out.iterdir()) == ["reversion_model.txt", "sentinel.txt", "trajectory_t60.txt"]
        assert (out / "trajectory_t60.txt").read_text() == "old model"
        assert not list(tmp_path.glob(".export-*"))

    def test_refuses_models_from_another_recipe(self, models, frame_with_park, tmp_path):
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        with pytest.raises(ValueError):
            export(models, frame_with_park, RECIPE_A, RIDE_CATS, STATUS_CATS, out_dir=tmp_path / "models")


class TestRecipeFromManifest:
    def test_round_trips_a_and_b(self, frame):
        from ml.manifest import manifest_for

        for recipe in (RECIPE_A, RECIPE_B):
            assert recipe_from_manifest(manifest_for(recipe, frame, HORIZONS)) == recipe

    def test_v1_manifest_is_recipe_a(self):
        assert recipe_from_manifest({"trained_through": "2026-10-04", "recipe": "A"}) == RECIPE_A
        assert recipe_from_manifest(None) == RECIPE_A

    def test_missing_fields_read_as_a_era_defaults(self):
        r = recipe_from_manifest({"recipe": "B"})
        assert r.trajectory_target == "level"
        assert r.trajectory_features == RECIPE_A.trajectory_features
