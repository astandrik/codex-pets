import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw
import renderer


class AnimationRevisionTests(unittest.TestCase):
    def test_policy_preserves_shape_and_applies_only_selected_corrections_in_order(self):
        job = {'prompt': '', 'reviewBase': True, 'animationAnatomyPolicy': 1, 'animationPrompt': 'Move gently',
               'animationRevision': {'selectedStates': ['waving'], 'corrections': {'waving': ['Tilt left', 'Tilt right instead']}}}
        row = {'name': 'waving', 'frames': 4, 'action': 'waves a hand'}
        text = renderer.row_prompt(job, row)
        self.assertIn('Tilt right instead', text)
        self.assertLess(text.index('Tilt left'), text.index('Tilt right instead'))
        self.assertIn('latest correction', text)
        self.assertIn('Do not invent', text)
        self.assertNotIn('full-body poses', text)
        self.assertNotIn('waves a hand', text)
        working = renderer.row_prompt(job, {'name': 'running', 'frames': 6, 'action': ''})
        self.assertNotIn('Tilt right', working)
        self.assertNotIn('Stable lower body', working)
        self.assertIn('stationary', working)
        gaze = renderer.row_prompt(job, {'name': 'look-0-157', 'frames': 8, 'action': ''})
        self.assertIn('existing eyes', gaze)
        self.assertNotIn('Move gently', gaze)
        self.assertNotIn('Tilt right', gaze)

    def test_partial_extraction_preserves_all_other_rows_and_clears_old_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Image.new('RGBA', (1536, 2288), (5, 40, 90, 127))
            source.save(root/'revision-source.webp', lossless=True, exact=True)
            Image.new('RGBA', (1024,1024), (255,0,255,255)).save(root/'base.png')
            rows = [{'name': 'idle', 'frames': 6, 'row': 0, 'action': 'resting'},
                    {'name': 'waving', 'frames': 4, 'row': 3, 'action': 'greeting'}]
            job = {'prompt': '', 'reviewBase': True, 'rows': rows,
                   'animationRevision': {'selectedStates': ['idle','waving'], 'corrections': {}}}
            for row in rows:
                strip = Image.new('RGBA', (1536,512), (255,0,255,255)); draw=ImageDraw.Draw(strip)
                for col in range(row['frames']):
                    x = int((col+.5)*1536/row['frames'])
                    draw.ellipse((x-45,180,x+45,320),fill=(100,180,50,255))
                strip.save(root/(row['name']+'.png'))
            calls=[]; real=renderer.run_tool
            def run(folder,args):
                calls.append(args)
                self.assertNotEqual(args[0], 'gen')
                return real(folder,args)
            with patch.object(renderer,'run_tool',side_effect=run): renderer.compose(root,job)
            with Image.open(root/'run/sprite-sheet-alpha.png') as result:
                self.assertEqual(result.size, source.size)
                for row in range(11):
                    bounds=(0,row*208,1536,(row+1)*208)
                    if row not in [0,3]: self.assertEqual(result.crop(bounds).tobytes(), source.crop(bounds).tobytes())
                    else: self.assertEqual(result.getpixel((0,row*208)), (0,0,0,0))
            extracts=[args for args in calls if args[0]=='extract']
            self.assertEqual(len(extracts),1)
            self.assertEqual(extracts[0][-2:],['--states','idle,waving'])
            self.assertFalse(any(args[0]=='compose-atlas' for args in calls))

if __name__ == '__main__': unittest.main()
