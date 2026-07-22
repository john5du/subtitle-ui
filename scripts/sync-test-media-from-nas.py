#!/usr/bin/env python3
"""Sync NAS movie/tv trees into project test media.

Real copy: NFO + app-used posters only.
Empty stubs: video + subtitle files.
Skip: junk, unused artwork, other files.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from pathlib import Path

VIDEO_EXT = {
    ".mkv",
    ".mp4",
    ".avi",
    ".m4v",
    ".mov",
    ".wmv",
    ".ts",
    ".m2ts",
    ".webm",
    ".mpg",
    ".mpeg",
}
SUB_EXT = {".srt", ".ass", ".ssa", ".sub", ".idx", ".vtt", ".sup"}
NFO_EXT = {".nfo"}
POSTER_EXT = {".jpg", ".png", ".bmp"}

MOVIE_POSTER_STEMS = {"poster", "movie", "folder", "cover"}
TV_POSTER_STEMS = {"poster", "folder", "fanart"}

JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}
JUNK_EXT = {".lnk", ".db"}
BACKUP_SUFFIX_RE = re.compile(r"\.\d{8}-\d{6}$")


def is_junk(path: Path) -> bool:
    name = path.name
    low = name.lower()
    if low in JUNK_NAMES:
        return True
    if path.suffix.lower() in JUNK_EXT:
        return True
    # e.g. file.ass.20260710-112134
    if BACKUP_SUFFIX_RE.search(name):
        return True
    stem = path.stem
    if BACKUP_SUFFIX_RE.search(stem):
        return True
    return False


def classify(rel: Path, kind: str) -> str:
    """Return action: nfo | poster | video | subtitle | skip."""
    if is_junk(rel):
        return "skip"

    ext = rel.suffix.lower()
    if ext in NFO_EXT:
        return "nfo"
    if ext in VIDEO_EXT:
        return "video"
    if ext in SUB_EXT:
        return "subtitle"
    if ext in POSTER_EXT:
        if kind == "movie":
            # only Title/file (one level under movie root)
            if len(rel.parts) != 2:
                return "skip"
            stem = rel.stem.lower()
            if stem in MOVIE_POSTER_STEMS or stem.endswith("-poster"):
                return "poster"
            # basename match for video base is loose: allow any stem at title dir
            # that is not clearly unused artwork names
            unused = {
                "fanart",
                "logo",
                "landscape",
                "banner",
                "backdrop",
                "clearart",
                "discart",
                "keyart",
            }
            if stem in unused or stem.startswith("backdrop"):
                return "skip"
            # cover already in MOVIE_POSTER_STEMS; remaining could be {videoBase}
            return "poster"
        # tv: only Series/file at series root
        if len(rel.parts) != 2:
            return "skip"
        stem = rel.stem.lower()
        if stem in TV_POSTER_STEMS:
            return "poster"
        return "skip"
    return "skip"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def clear_dir(path: Path) -> None:
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
        return
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)


def is_within(child: Path, parent: Path) -> bool:
    """True if child is parent or a descendant of parent (resolved paths)."""
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def paths_overlap(a: Path, b: Path) -> bool:
    return a == b or is_within(a, b) or is_within(b, a)


def resolve_existing_dir(path: Path, role: str) -> Path:
    """Resolve path and require an existing real directory (not a symlink leaf)."""
    expanded = path.expanduser()
    if expanded.is_symlink():
        raise SystemExit(f"{role} must not be a symlink: {expanded}")
    if not expanded.exists():
        raise SystemExit(f"{role} not found (is NAS mounted?): {expanded}")
    if not expanded.is_dir():
        raise SystemExit(f"{role} is not a directory: {expanded}")
    resolved = expanded.resolve()
    # After resolve, refuse if the final path is still a symlink (rare) or missing.
    if not resolved.is_dir():
        raise SystemExit(f"{role} did not resolve to a directory: {path} -> {resolved}")
    return resolved


def resolve_dest_dir(path: Path, role: str) -> Path:
    """Resolve destination; may not exist yet, but must not be a symlink."""
    expanded = path.expanduser()
    if expanded.exists() and expanded.is_symlink():
        raise SystemExit(f"{role} must not be a symlink: {expanded}")
    # Resolve parent chain; if path exists, resolve fully.
    if expanded.exists():
        if not expanded.is_dir():
            raise SystemExit(f"{role} exists but is not a directory: {expanded}")
        return expanded.resolve()
    # Non-existent: resolve parent and append name so relative paths work.
    parent = expanded.parent
    if not parent.exists():
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise SystemExit(f"{role} parent cannot be created: {parent}: {exc}") from exc
    if parent.is_symlink():
        raise SystemExit(f"{role} parent must not be a symlink: {parent}")
    return (parent.resolve() / expanded.name)


def validate_sync_layout(
    repo: Path,
    movie_src: Path,
    tv_src: Path,
    movie_dst: Path,
    tv_dst: Path,
) -> None:
    """Refuse unsafe source/destination combinations before any wipe or copy."""
    pairs = (
        ("movie source", movie_src, "movie destination", movie_dst),
        ("tv source", tv_src, "tv destination", tv_dst),
    )
    for src_role, src, dst_role, dst in pairs:
        if paths_overlap(src, dst):
            raise SystemExit(
                f"{src_role} and {dst_role} overlap or are identical:\n"
                f"  src={src}\n  dst={dst}\n"
                "Refusing to clear/sync (would delete or corrupt source data)."
            )

    if paths_overlap(movie_dst, tv_dst):
        raise SystemExit(
            f"movie and tv destinations overlap or are identical:\n"
            f"  movie_dst={movie_dst}\n  tv_dst={tv_dst}"
        )
    if paths_overlap(movie_src, tv_dst) or paths_overlap(tv_src, movie_dst):
        raise SystemExit(
            "cross media source/destination paths overlap; refusing unsafe layout"
        )

    for role, dst in (("movie destination", movie_dst), ("tv destination", tv_dst)):
        if dst == repo or is_within(repo, dst):
            raise SystemExit(
                f"{role} is the repo root or an ancestor of the repo:\n"
                f"  dst={dst}\n  repo={repo}\n"
                "Refusing to clear (would wipe the repository)."
            )
        # Extra guard: never clear filesystem roots.
        if dst.parent == dst:
            raise SystemExit(f"{role} resolves to filesystem root: {dst}")


def sync_tree(
    src_root: Path,
    dst_root: Path,
    kind: str,
    dry_run: bool,
) -> dict[str, int]:
    stats = {
        "nfo": 0,
        "poster": 0,
        "video": 0,
        "subtitle": 0,
        "skip": 0,
        "bytes_copied": 0,
        "errors": 0,
    }

    if not src_root.is_dir():
        raise SystemExit(f"source not found or not a directory: {src_root}")

    for dirpath, dirnames, filenames in os.walk(src_root):
        # skip hidden dirs
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        src_dir = Path(dirpath)
        for fn in filenames:
            if fn.startswith("."):
                stats["skip"] += 1
                continue
            src = src_dir / fn
            try:
                rel = src.relative_to(src_root)
            except ValueError:
                stats["skip"] += 1
                continue
            action = classify(rel, kind)
            if action == "skip":
                stats["skip"] += 1
                continue

            dst = dst_root / rel
            try:
                if action in ("nfo", "poster"):
                    size = src.stat().st_size
                    if not dry_run:
                        ensure_parent(dst)
                        shutil.copy2(src, dst)
                    stats[action] += 1
                    stats["bytes_copied"] += size
                elif action in ("video", "subtitle"):
                    if not dry_run:
                        ensure_parent(dst)
                        dst.write_bytes(b"")
                        try:
                            shutil.copystat(src, dst, follow_symlinks=True)
                        except OSError:
                            pass
                    stats[action] += 1
                else:
                    stats["skip"] += 1
            except OSError as exc:
                stats["errors"] += 1
                print(f"error: {src}: {exc}", file=sys.stderr)

    return stats


def fmt_bytes(n: int) -> str:
    size = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GiB"


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--movie-src",
        type=Path,
        default=Path("/Users/du/mountmate/nas/movie"),
    )
    p.add_argument(
        "--tv-src",
        type=Path,
        default=Path("/Users/du/mountmate/nas/tv"),
    )
    p.add_argument(
        "--movie-dst",
        type=Path,
        default=repo / "media" / "movies",
    )
    p.add_argument(
        "--tv-dst",
        type=Path,
        default=repo / "media" / "tv",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--no-clear",
        action="store_true",
        help="do not wipe destination trees first",
    )
    args = p.parse_args()

    # Validate sources first — never clear destinations if NAS is missing.
    movie_src = resolve_existing_dir(args.movie_src, "movie source")
    tv_src = resolve_existing_dir(args.tv_src, "tv source")
    movie_dst = resolve_dest_dir(args.movie_dst, "movie destination")
    tv_dst = resolve_dest_dir(args.tv_dst, "tv destination")

    validate_sync_layout(repo, movie_src, tv_src, movie_dst, tv_dst)

    print(f"movie: {movie_src} -> {movie_dst}")
    print(f"tv:    {tv_src} -> {tv_dst}")
    print(f"mode:  {'dry-run' if args.dry_run else 'write'}")

    if not args.dry_run and not args.no_clear:
        print("clearing destinations...")
        clear_dir(movie_dst)
        clear_dir(tv_dst)

    print("syncing movies...")
    m = sync_tree(movie_src, movie_dst, "movie", args.dry_run)
    print("syncing tv...")
    t = sync_tree(tv_src, tv_dst, "tv", args.dry_run)

    def show(label: str, s: dict[str, int]) -> None:
        print(
            f"{label}: nfo={s['nfo']} poster={s['poster']} "
            f"video_stub={s['video']} sub_stub={s['subtitle']} "
            f"skip={s['skip']} copied={fmt_bytes(s['bytes_copied'])} "
            f"errors={s['errors']}"
        )

    show("movies", m)
    show("tv", t)
    total_copied = m["bytes_copied"] + t["bytes_copied"]
    total_stubs = m["video"] + m["subtitle"] + t["video"] + t["subtitle"]
    print(
        f"total: real_copy={fmt_bytes(total_copied)} stubs={total_stubs} "
        f"errors={m['errors'] + t['errors']}"
    )

    if not args.dry_run:
        # report on-disk size
        def du(path: Path) -> int:
            total = 0
            for root, _, files in os.walk(path):
                for fn in files:
                    try:
                        total += (Path(root) / fn).stat().st_size
                    except OSError:
                        pass
            return total

        print(f"on-disk movies: {fmt_bytes(du(movie_dst))} ({movie_dst})")
        print(f"on-disk tv:     {fmt_bytes(du(tv_dst))} ({tv_dst})")

    return 0 if (m["errors"] + t["errors"]) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
