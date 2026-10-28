import unittest
import cv2
import numpy as np
from PIL import Image
from ocr import aligned_pair


class AlignmentTests(unittest.TestCase):
    def test_ecc_transforms_before_into_after_coordinates(self):
        rng = np.random.default_rng(42)
        source = rng.integers(0, 256, (256,256,3), dtype=np.uint8)
        source = cv2.GaussianBlur(source, (9,9), 0)
        target = cv2.warpAffine(source, np.float32([[1,0,7],[0,1,-5]]), (256,256))
        aligned, valid, matrix = aligned_pair(Image.fromarray(source), Image.fromarray(target), True)
        self.assertAlmostEqual(matrix[0][2], 7, delta=1)
        self.assertAlmostEqual(matrix[1][2], -5, delta=1)
        active = valid > 0
        error = np.abs(aligned.astype(float) - target.astype(float))[active].mean()
        self.assertLess(error, 2)


if __name__ == '__main__':
    unittest.main()
