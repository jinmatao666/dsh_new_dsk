import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from ocr import deduplicate, english_target, extract


class DetectionTests(unittest.TestCase):
    def test_common_chinese_target_does_not_require_translation_model(self):
        with patch('ocr.model_configuration', side_effect=AssertionError('unnecessary model request')):
            self.assertEqual(english_target('建筑物'), 'building')
            self.assertEqual(english_target('汽车'), 'car')
            self.assertEqual(english_target('red car'), 'red car')

    def test_dedup_keeps_highest_score_and_separate_objects(self):
        objects = [{'box': box, 'score': score, 'mask': None} for box, score in (
            ([.1,.1,.3,.3], .7), ([.101,.101,.301,.301], .9), ([.4,.4,.6,.6], .8))]
        result = deduplicate(objects)
        self.assertEqual([obj['score'] for obj in result], [.9, .8])
        a = np.zeros((10,10), dtype=bool)
        a[:5] = True
        same_box = [{'box': [.1,.1,.3,.3], 'score': .9, 'mask': a},
                    {'box': [.1,.1,.3,.3], 'score': .8, 'mask': ~a}]
        self.assertEqual(len(deduplicate(same_box)), 2)

    def test_export_coordinates_reference_original_image_after_resize(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'input.png'
            Image.new('RGB', (2400, 1200), 'white').save(path)
            objects = [{'box': [.1,.2,.3,.4], 'score': .9, 'mask': None}]
            with patch('ocr.sam_segment', return_value=objects):
                outputs = extract([path], Path(tmp)/'out', {'target': 'car'})
            result = json.loads(outputs[0].read_text(encoding='utf-8'))
            self.assertEqual(result['image']['width'], 1600)
            self.assertEqual(result['objects'][0]['box_original_pixels'], [240,240,720,480])
            self.assertEqual(result['duplicate_count'], 0)
            self.assertIn('xmin_original_px', (Path(tmp)/'out'/'objects.csv').read_text(encoding='utf-8-sig'))


if __name__ == '__main__':
    unittest.main()
