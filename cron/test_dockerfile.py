"""Guard: every local module the cron entrypoints import must be COPYed into
the image. On 2026-10-18 crowd_features.py was added to predict.py but not to
the Dockerfile, and every Cloud Run execution crashed on import for 45 minutes
while the app served stale predictions."""
import re
from pathlib import Path

HERE = Path(__file__).parent
ENTRYPOINTS = ["predict.py", "compute_averages.py", "build_closure_profiles.py"]


def _local_modules():
    return {p.stem for p in HERE.glob("*.py") if not p.name.startswith("test_")}


def _imported_local_modules(path: Path, local: set[str]) -> set[str]:
    text = path.read_text()
    found = set()
    for m in re.finditer(r"^\s*(?:from\s+(\w+)\s+import|import\s+(\w+))", text, re.M):
        name = m.group(1) or m.group(2)
        if name in local:
            found.add(name)
    return found


def _copied_files() -> set[str]:
    copied = set()
    for line in (HERE / "Dockerfile").read_text().splitlines():
        if line.startswith("COPY "):
            parts = line.split()[1:-1]  # drop COPY and the destination
            copied.update(parts)
    return copied


def test_dockerfile_copies_every_imported_module():
    local = _local_modules()
    copied = _copied_files()
    needed = set()
    for entry in ENTRYPOINTS:
        needed.add(entry)
        # one level of transitive imports is enough for this codebase
        for mod in _imported_local_modules(HERE / entry, local):
            needed.add(f"{mod}.py")
            for sub in _imported_local_modules(HERE / f"{mod}.py", local):
                needed.add(f"{sub}.py")
    missing = sorted(needed - copied)
    assert not missing, f"Dockerfile COPY is missing modules the cron imports: {missing}"
