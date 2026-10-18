import json

import lightgbm as lgb
import pytest

from ml import export as export_mod
from ml.export import HORIZONS, export, train_all
from ml.manifest import read_manifest, recipe_from_manifest
from ml.recipes import RECIPE_A, RECIPE_B, with_

TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
TINY_B = with_(RECIPE_B, trajectory_params=TINY, day_profile_params=TINY)


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


class TestExport:
    def test_writes_every_file_and_v2_manifest(self, models, frame_with_park, tmp_path):
        reversion = lgb.LGBMRegressor(**TINY).fit(frame_with_park[["wait_minutes"]].fillna(0),
                                                 frame_with_park["hour_of_day"])
        manifest = _export(models, frame_with_park, tmp_path / "models",
                           reversion_model=reversion, ride_percentile_buckets={"r1__9_weekday": {"p50": 5.0}})
        names = {p.name for p in (tmp_path / "models").iterdir()}
        expected = {f"trajectory_t{h}.txt" for h in HORIZONS} | {
            "day_profile.txt", "feature_categories.json", "ride_regime_thresholds.json",
            "crowd_level_baselines.json", "reversion_model.txt", "ride_percentile_buckets.json", "manifest.json"}
        assert names == expected
        on_disk = read_manifest(tmp_path / "models" / "manifest.json")
        assert on_disk == manifest
        assert manifest["recipe"] == "B" and manifest["trajectory_target"] == "delta"
        assert manifest["trajectory_features"] == list(RECIPE_B.trajectory_features)
        assert manifest["day_profile_features"] == list(RECIPE_B.day_profile_features)
        assert manifest["horizons"] == HORIZONS
        assert manifest["trained_through"] == str(frame_with_park["date_la"].max())
        assert manifest["frame_rows"] == len(frame_with_park)
        assert manifest["frame_range"] == [str(frame_with_park["date_la"].min()), manifest["trained_through"]]
        assert manifest["reversion_exported"] is True
        booster = lgb.Booster(model_file=str(tmp_path / "models" / "trajectory_t60.txt"))
        assert booster.feature_name() == list(RECIPE_B.trajectory_features)
        cats = json.loads((tmp_path / "models" / "feature_categories.json").read_text())
        assert set(cats) == {"ride_id_categories", "status_categories"}
        assert not list(tmp_path.glob(".export-*"))  # temp dir cleaned up

    def test_reversion_files_left_alone_when_not_given(self, models, frame_with_park, tmp_path):
        out = tmp_path / "models"
        out.mkdir()
        (out / "reversion_model.txt").write_text("old reversion")
        manifest = _export(models, frame_with_park, out)
        assert (out / "reversion_model.txt").read_text() == "old reversion"
        assert not (out / "ride_percentile_buckets.json").exists()
        assert manifest["reversion_exported"] is False

    def test_failure_leaves_out_dir_untouched(self, models, frame_with_park, tmp_path, monkeypatch):
        out = tmp_path / "models"
        out.mkdir()
        (out / "sentinel.txt").write_text("keep me")
        (out / "trajectory_t60.txt").write_text("old model")

        def boom(*a, **k):
            raise RuntimeError("thresholds failed")

        monkeypatch.setattr(export_mod.crowd_features, "regime_thresholds", boom)
        with pytest.raises(RuntimeError):
            _export(models, frame_with_park, out)
        assert sorted(p.name for p in out.iterdir()) == ["sentinel.txt", "trajectory_t60.txt"]
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
