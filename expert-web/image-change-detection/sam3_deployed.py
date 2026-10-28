"""Adapter for sam3-http:v1 /v1/images/segment, as documented by deployed OpenAPI."""
import math
import os
from service_http import post_json, ServiceError


def recognize(image, encoded, prompt, boxes, score):
    payload = {'image_base64': encoded, 'prompt': prompt,
               'confidence_threshold': score, 'max_detections': 50,
               'mask_format': 'png_base64', 'mask_space': 'original'}
    if boxes:
        payload['positive_boxes'] = [[x0 * image.width, y0 * image.height,
                                       x1 * image.width, y1 * image.height] for x0, y0, x1, y1 in boxes]
    result = post_json(os.environ.get('SAM3_URL', ''), payload,
                       os.environ.get('SAM3_KEY', ''), timeout=90)
    size = [image.width, image.height]
    if (result.get('original_size') != size or result.get('mask_size') != size
            or result.get('roi_xyxy') != [0, 0, *size]
            or result.get('mask_coordinate_space') != 'original'
            or result.get('box_coordinate_space', 'original') != 'original'):
        raise ServiceError('SAM3图片尺寸、ROI或掩膜坐标空间不匹配')
    instances = result.get('instances')
    total = result.get('total_detections')
    if (not isinstance(instances, list) or len(instances) > 50 or isinstance(total, bool)
            or not isinstance(total, int) or total != len(instances)):
        raise ServiceError('SAM3结果无效或超过返回上限，请裁小图片或提高阈值')
    objects = []
    for instance in instances:
        box, mask = instance['box_xyxy'], instance['mask']
        if (not isinstance(box, list) or len(box) != 4
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in box)
                or not 0 <= box[0] < box[2] <= image.width
                or not 0 <= box[1] < box[3] <= image.height):
            raise ServiceError('SAM3像素框超出原图')
        if (not isinstance(mask, dict) or mask.get('format') != 'png_base64'
                or mask.get('size') != [image.height, image.width] or not isinstance(mask.get('data'), str)
                or instance.get('score_source') != 'detector'):
            raise ServiceError('SAM3概念分割的掩膜格式或分数来源不匹配')
        objects.append({'box': [box[0] / image.width, box[1] / image.height,
                                box[2] / image.width, box[3] / image.height],
                        'score': instance['score'], 'score_source': instance['score_source'],
                        'mask_png': mask['data']})
    return {'schema_version': 1, 'width': image.width, 'height': image.height, 'objects': objects}
