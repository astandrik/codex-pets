"""Real CLI contracts for coloured subjects on a magenta background, offline."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
import renderer

ROWS = [("idle", 6), ("running-right", 8), ("running-left", 8),
        ("waving", 4), ("jumping", 5), ("failed", 8), ("waiting", 6),
        ("running", 6), ("review", 6), ("look-0-157", 8), ("look-180-337", 8)]
# Pink sampled from the saved pilot's jumping strip; lilac is a second
# subject colour outside the matte's key radius but inside the old QA radius.
PINK = (237, 122, 173, 255)
LILAC = (213, 112, 246, 255)


def coloured_strip(count, *, leftover_key=False):
    strip = Image.new("RGBA", (1536, 512), (255, 0, 255, 255))
    draw = ImageDraw.Draw(strip)
    for index in range(count):
        x = round((index + .5) * strip.width / count)
        draw.rectangle((x-58, 170, x+58, 340), fill="#202020")
        draw.rectangle((x-50, 178, x, 332), fill=PINK)
        draw.rectangle((x+1, 178, x+50, 332), fill=LILAC)
        if leftover_key:
            draw.rectangle((x-30, 220, x+30, 280), fill=(255, 48, 255, 255))
    return strip


def workspace(root, *, revision=False, leftover_key=False):
    rows = [(name, count, index) for index, (name, count) in enumerate(ROWS)
            if not revision or name in ("idle", "jumping")]
    coloured_strip(1).save(root / "base.png")
    for name, count, _ in rows:
        coloured_strip(count, leftover_key=leftover_key).save(root / (name + ".png"))
    job = {"prompt": "Offline fixture", "reviewBase": True, "rows": [
        {"name": name, "frames": count, "row": index, "action": ""}
        for name, count, index in rows]}
    if revision:
        Image.new("RGBA", (1536, 2288), (10, 80, 140, 127)).save(
            root / "revision-source.webp", lossless=True, exact=True)
        job["animationRevision"] = {"selectedStates": [row[0] for row in rows], "corrections": {}}
    return job


class ChromaValidationTests(unittest.TestCase):
    def compose_offline(self, root, job, *, leave_key_pixels=False):
        real_tool = renderer.run_tool
        commands = []

        def tool(folder, args):
            self.assertIn(args[0], ("prepare", "extract", "compose-atlas"))
            commands.append(args[0])
            if args[0] == "extract" and leave_key_pixels:
                # Simulate an incomplete matte, keeping the production QA options.
                # The exact magenta background still keys out; the near-key patch
                # inside each pose survives and must be rejected by the real CLI.
                args = [*args, "--key-threshold", "0", "--fringe-unmix-reach", "0",
                        "--spill-max-fraction", "0"]
            return real_tool(folder, args)

        with patch.object(renderer, "run_tool", side_effect=tool):
            renderer.compose(root, job)
        return commands

    def assert_subject_colours(self, frame):
        colours = dict((colour, count) for count, colour in frame.getcolors(frame.width * frame.height))
        self.assertGreater(colours.get(PINK, 0), 500)
        self.assertGreater(colours.get(LILAC, 0), 500)
        self.assertEqual(frame.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertNotIn((255, 0, 255, 255), colours)

    def test_full_atlas_keeps_pink_and_lilac_without_retry_or_recolouring(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = workspace(root)
            originals = {p.name: p.read_bytes() for p in root.glob("*.png")}
            commands = self.compose_offline(root, job)
            self.assertEqual(commands, ["prepare", "extract", "compose-atlas"])
            manifest = json.loads((root / "run/frames/frames-manifest.json").read_text())
            self.assertEqual((manifest["errors"], manifest["warnings"]), ([], []))
            self.assertEqual(sum(row["frames"] for row in manifest["rows"]), 73)
            for row in manifest["rows"]:
                for file in row["files"]:
                    with Image.open(root / "run" / file) as frame:
                        self.assert_subject_colours(frame.convert("RGBA"))
            for name, data in originals.items():
                self.assertEqual((root / name).read_bytes(), data)

    def test_revision_keeps_colours_and_does_not_change_unselected_rgba_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = workspace(root, revision=True)
            self.assertEqual(self.compose_offline(root, job), ["prepare", "extract"])
            with Image.open(root / "run/sprite-sheet-alpha.png") as result, Image.open(root / "revision-source.webp") as source:
                for row in range(11):
                    bounds = (0, row * 208, 1536, (row + 1) * 208)
                    if row in (0, 4):
                        self.assert_subject_colours(result.crop((0, row * 208, 192, (row + 1) * 208)))
                    else:
                        self.assertEqual(result.crop(bounds).tobytes(), source.crop(bounds).tobytes())

    def test_incomplete_matte_still_fails_chroma_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = workspace(root, revision=True, leftover_key=True)
            with self.assertRaisesRegex(renderer.RenderError, "invalid_sprite_extraction"):
                self.compose_offline(root, job, leave_key_pixels=True)
            failure = json.loads((root / "run/extract-failure.json").read_text())
            self.assertTrue(any("chroma-adjacent pixels" in error for error in failure["errors"]))
            self.assertFalse((root / "run/sprite-sheet-alpha.png").exists())


if __name__ == "__main__":
    unittest.main()
