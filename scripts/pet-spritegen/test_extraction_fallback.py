"""Offline contracts for local extraction recovery; no provider requests."""
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


def strip(count, *, missing=None, bridge=0, width=1536, height=512):
    image = Image.new("RGB", (width, height), "#FF00FF")
    draw = ImageDraw.Draw(image)
    slot = width / count
    boxes = []
    for index in range(count):
        box = (round(slot * (index + .15)), round(height * .25),
               round(slot * (index + .85)), round(height * .75))
        boxes.append(box)
        if index != missing:
            draw.rounded_rectangle(box, radius=12, fill="#dfac42", outline="#242424", width=3)
    if bridge:
        for index in (0, 1):
            if missing in (index, index + 1):
                continue
            y = height // 2
            draw.rectangle((boxes[index][2] - 2, y, boxes[index + 1][0] + 2, y + bridge - 1), fill="#242424")
    return image


class ComposeFallbackTests(unittest.TestCase):
    def test_recovers_only_touching_rows_without_provider_calls(self):
        from sprite_gen.spec.layout import raw_rel
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            strip(1).resize((1024, 1024)).save(root / "base.png")
            for name, count in ROWS:
                strip(count, bridge=2 if name in ("idle", "look-0-157") else 0).save(root / (name + ".png"))
            originals = {path.name: path.read_bytes() for path in root.glob("*.png")}
            job = {"prompt": "Synthetic offline fixture", "rows": [
                {"name": name, "frames": count, "action": ""} for name, count in ROWS]}
            commands = []
            original_tool = renderer.run_tool

            def offline_tool(workspace, args):
                self.assertIn(args[0], ("prepare", "extract", "compose-atlas"))
                commands.append(args[0])
                return original_tool(workspace, args)

            with patch.object(renderer, "run_tool", side_effect=offline_tool):
                try:
                    result = renderer.compose(root, job)
                except renderer.RenderError as error:
                    self.fail(f"Touching poses must recover locally: {error}")
                self.assertEqual(result, {"ok": True})
            manifest = json.loads((root / "run/frames/frames-manifest.json").read_text())
            self.assertEqual((len(manifest["rows"]), sum(row["frames"] for row in manifest["rows"])), (11, 73))
            self.assertEqual((manifest["errors"], manifest["warnings"]), ([], []))
            self.assertEqual(commands, ["prepare", "extract", "extract", "compose-atlas"])
            request = json.loads((root / "run/sprite-request.json").read_text())
            for name, _ in ROWS:
                self.assertEqual((root / (name + ".png")).read_bytes(), originals[name + ".png"])
                if name not in ("idle", "look-0-157"):
                    self.assertEqual((root / "run" / raw_rel(request, name)).read_bytes(), originals[name + ".png"])


class StripRecoveryTests(unittest.TestCase):
    def recover(self, image, frames):
        from extraction_fallback import separate_touching_poses
        before = image.tobytes()
        result = separate_touching_poses(image, frames)
        self.assertEqual(image.tobytes(), before)
        return result

    def test_separates_thin_contacts_without_painting_or_resizing(self):
        from sprite_gen.frames.extract import connected_components, remove_chroma_background
        for count in (4, 6, 8):
            with self.subTest(frames=count):
                image = strip(count, bridge=2, width=count * 128, height=128)
                recovered = self.recover(image, count)
                self.assertIsNotNone(recovered)
                self.assertEqual(recovered.size, image.size)
                self.assertEqual(recovered.convert("RGB").tobytes(), image.tobytes())
                alpha = remove_chroma_background(recovered, (255, 0, 255), 96, 180, 18)
                self.assertEqual(len(connected_components(alpha)), count)

    def test_already_separate_poses_are_not_modified(self):
        self.assertIsNone(self.recover(strip(6, width=768, height=128), 6))

    def test_missing_pose_is_not_manufactured_by_cutting_a_neighbor(self):
        for missing in (0, 2, 5):
            with self.subTest(missing=missing):
                self.assertIsNone(self.recover(strip(6, missing=missing, bridge=2, width=768, height=128), 6))

    def test_five_poses_spread_across_six_requested_slots_are_rejected(self):
        self.assertIsNone(self.recover(strip(5, bridge=2, width=768, height=128), 6))

    def test_strong_overlap_is_rejected_even_when_the_join_is_dark(self):
        for thickness in (18, 40):
            with self.subTest(thickness=thickness):
                self.assertIsNone(self.recover(strip(6, bridge=thickness, width=768, height=128), 6))

    def test_overlapping_bodies_cannot_be_recovered_as_complete_poses(self):
        image = Image.new('RGB', (768, 128), '#FF00FF')
        draw = ImageDraw.Draw(image)
        for index in range(6):
            draw.rounded_rectangle((index * 128 + 8, 20, index * 128 + 155, 108),
                                   radius=12, fill='#dfac42', outline='#242424', width=3)
        self.assertIsNone(self.recover(image, 6))

    def test_squat_bodies_joined_over_their_full_height_are_rejected(self):
        image = Image.new('RGB', (1536, 512), '#FF00FF')
        draw = ImageDraw.Draw(image)
        for index in range(6):
            draw.rectangle((index * 256 + 30, 246, index * 256 + 220, 265), fill='#242424')
        draw.rectangle((220, 246, 286, 265), fill='#242424')
        self.assertIsNone(self.recover(image, 6))

    def test_empty_strip_and_out_of_contract_dimensions_are_rejected(self):
        self.assertIsNone(self.recover(Image.new("RGB", (768, 128), "#FF00FF"), 6))
        self.assertIsNone(self.recover(Image.new("RGB", (1600, 512), "black"), 6))
        for count in (0, 1, 9):
            self.assertIsNone(self.recover(strip(6, bridge=2, width=768, height=128), count))


class FailureSelectionTests(unittest.TestCase):
    def test_only_matching_component_count_failures_are_eligible(self):
        from extraction_fallback import recover_failed_strips
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = [{"name": "idle", "frames": 6}]
            for errors in ([], ["unknown: could not extract 6 sprite components"],
                           ["idle: could not extract 8 sprite components"],
                           ["idle: frame 00 has 200 chroma-adjacent pixels"],
                           ["idle: could not extract 6 sprite components", "private exception"]):
                (root / "extract-failure.json").write_text(json.dumps({"ok": False, "errors": errors, "warnings": []}))
                with patch("extraction_fallback.separate_touching_poses") as recover:
                    self.assertFalse(recover_failed_strips(root, job))
                    recover.assert_not_called()

    def test_rejected_second_strip_leaves_the_whole_batch_untouched(self):
        from extraction_fallback import recover_failed_strips
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            rows = [{"name": "idle", "frames": 6}, {"name": "running", "frames": 6}]
            (root / "sprite-request.json").write_text('{}')
            (root / "extract-failure.json").write_text(json.dumps({"ok": False, "warnings": [], "errors": [
                f'{row["name"]}: could not extract 6 sprite components' for row in rows]}))
            strip(6, bridge=2, width=768, height=128).save(root / "raw/idle.png")
            strip(6, missing=3, bridge=2, width=768, height=128).save(root / "raw/running.png")
            before = {path.name: path.read_bytes() for path in (root / "raw").glob('*.png')}
            self.assertFalse(recover_failed_strips(root, rows))
            self.assertEqual({path.name: path.read_bytes() for path in (root / "raw").glob('*.png')}, before)


class RetryBoundaryTests(unittest.TestCase):
    def compose_with(self, root, side_effect):
        (root / 'run').mkdir()
        (root / 'run/sprite-request.json').write_text('{}')
        (root / 'run/extract-failure.json').write_text('{"ok":false,"errors":["idle: could not extract 6 sprite components"],"warnings":[]}')
        strip(6, bridge=2, width=768, height=128).save(root / 'idle.png')
        job = {'rows': [{'name': 'idle', 'frames': 6}]}
        with patch.object(renderer, 'prepare'), patch.object(renderer, 'run_tool', side_effect=side_effect) as tool:
            with self.assertRaises(renderer.RenderError):
                renderer.compose(root, job)
        return tool

    def test_timeout_and_unknown_failure_do_not_trigger_recovery(self):
        for diagnostic in (None, {'reason': 'process_timeout'},
                           {'boundary': 'provider_cli', 'reason': 'process_exit', 'exitCode': 1}):
            with self.subTest(diagnostic=diagnostic), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                error = renderer.RenderError('invalid_sprite_extraction', failure_diagnostic=diagnostic)
                with patch('extraction_fallback.recover_failed_strips') as recover:
                    tool = self.compose_with(root, error)
                    recover.assert_not_called()
                self.assertEqual(tool.call_count, 1)
                self.assertFalse((root / 'run/extract-failure.json').exists())

    def test_recovery_retries_local_extraction_only_once(self):
        error = renderer.RenderError('invalid_sprite_extraction', failure_diagnostic={
            'boundary': 'renderer_process', 'reason': 'process_exit', 'exitCode': 1})
        with tempfile.TemporaryDirectory() as directory, patch('extraction_fallback.recover_failed_strips', return_value=True) as recover:
            tool = self.compose_with(Path(directory), [error, error])
            self.assertEqual([call.args[1][0] for call in tool.call_args_list], ['extract', 'extract'])
            recover.assert_called_once()

    def test_missing_pose_stops_compose_without_an_extraction_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'run').mkdir()
            (root / 'run/sprite-request.json').write_text('{}')
            strip(6, missing=2, bridge=2).save(root / 'idle.png')
            before = (root / 'idle.png').read_bytes()
            error = renderer.RenderError('invalid_sprite_extraction', failure_diagnostic={
                'boundary': 'renderer_process', 'reason': 'process_exit', 'exitCode': 1})

            def failed_extract(_root, args):
                self.assertEqual(args[0], 'extract')
                (root / 'run/extract-failure.json').write_text(json.dumps({
                    'ok': False, 'warnings': [], 'errors': ['idle: could not extract 6 sprite components']}))
                raise error

            with patch.object(renderer, 'prepare'), patch.object(renderer, 'run_tool', side_effect=failed_extract) as tool:
                with self.assertRaises(renderer.RenderError) as raised:
                    renderer.compose(root, {'rows': [{'name': 'idle', 'frames': 6}]})
            self.assertIs(raised.exception, error)
            self.assertEqual(tool.call_count, 1)
            self.assertEqual((root / 'idle.png').read_bytes(), before)
            self.assertEqual((root / 'run/raw/idle.png').read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
