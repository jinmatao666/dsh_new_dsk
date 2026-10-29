"""Two-image semantic discovery followed by candidate-specific localization."""
import base64
import io
import json
import math
import os
from service_http import post_json, ServiceError

TYPES = {'new', 'disappeared', 'expanded', 'shrunk', 'modified'}


def image_url(image):
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()


def ask(images, prompt):
    payload = {'model': os.environ.get('EXPERT_MODEL', ''), 'stream': False,
        'temperature': 0, 'max_tokens': 4096, 'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': '第一张为变化前，第二张为变化后。' + prompt},
            *[{'type': 'image_url', 'image_url': {'url': image}} for image in images]]}]}
    try:
        result = post_json(os.environ.get('EXPERT_MODEL_URL', ''), payload,
            os.environ.get('EXPERT_MODEL_KEY', ''), timeout=120, limit=512*1024,
            allow_http=os.environ.get('EXPERT_ALLOW_HTTP_MODEL') == '1')
        choice = result['choices'][0]
        if choice.get('finish_reason') != 'stop':
            raise ValueError('incomplete response')
        text = choice['message']['content']
        if not isinstance(text, str):
            raise ValueError('not text')
        text = text.strip()
        if text.startswith('```') and text.endswith('```'):
            text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        value = json.loads(text)
        json.dumps(value, allow_nan=False)
        if not isinstance(value, dict):
            raise ValueError('not object')
        return value
    except (ServiceError, KeyError, IndexError, TypeError, ValueError):
        raise ValueError('视觉模型调用失败、输出不完整或JSON无效；请确认模型支持双图输入。') from None


def box(value):
    if not isinstance(value, list) or len(value) != 4 or any(
            isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 <= x <= 999 for x in value):
        raise ValueError('模型坐标无效，须为0至999的四个有限数值')
    if value[0] >= value[2] or value[1] >= value[3]:
        raise ValueError('模型返回了反向或零面积坐标')
    return [x / 999 for x in value]


def overlap(a, b):
    intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
    area_a = (a[2]-a[0])*(a[3]-a[1])
    area_b = (b[2]-b[0])*(b[3]-b[1])
    return intersection / (area_a+area_b-intersection), intersection / min(area_a, area_b)


def discover(before, after):
    images = [image_url(before), image_url(after)]
    discovery = ask(images, """比较同一范围的两期图片，识别新增、消失、扩张、缩小、修改的地物。
忽略阴影、光照、季节性色差、轻微纹理和瞬时小目标。空间连续且属于同一变化事件的相邻同类地物合成一个区域候选。
不要按网格拆分，不强行找变化，不输出坐标。只返回JSON：
{"candidates":[{"change_type":"new","category":"建筑","description":"新增厂房","approximate_region":"右上"}]}。
确认无变化返回{"candidates":[]}。最多24个候选；不要为满足数量编造内容。""")
    candidates = discovery.get('candidates')
    if not isinstance(candidates, list) or len(candidates) > 24:
        raise ValueError('视觉模型变化候选无效或过多，请裁剪关注区域后重试')
    objects, evidence = [], {'discovery': discovery, 'localizations': []}
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get('change_type') not in TYPES:
            raise ValueError('模型变化类型无效')
        for key in ['category', 'description', 'approximate_region']:
            if not isinstance(candidate.get(key), str) or not 1 <= len(candidate[key]) <= 1000:
                raise ValueError('模型变化描述缺失或过长')
        answer = ask(images, '定位这个变化候选：' + json.dumps(candidate, ensure_ascii=False) + """
只定位该候选，不新增其他事件。同一连续变化区域使用一个紧致框，明显分离的区域才分开。
每个框是完整单张图片上的[x1,y1,x2,y2]，左上原点，0至999坐标。新增目标bbox_before为null；消失目标须提供前期目标框，后期框指向原目标所在地。其他类型尽量提供前后框。
每项必须有bbox_after。无法可靠定位返回objects空数组，不猜测坐标。
只返回JSON：{"objects":[{"bbox_before":null,"bbox_after":[100,100,300,300]}]}。""")
        evidence['localizations'].append(answer)
        regions = answer.get('objects')
        if not isinstance(regions, list) or not regions or len(regions) > 8:
            raise ValueError('模型无法可靠定位变化或返回区域过多；未生成替代框，请调整图片后重试')
        for region in regions:
            if not isinstance(region, dict):
                raise ValueError('模型定位结构无效')
            after_box = box(region.get('bbox_after'))
            before_box = box(region['bbox_before']) if region.get('bbox_before') is not None else None
            if candidate['change_type'] == 'disappeared' and before_box is None:
                raise ValueError('消失目标缺少前期位置')
            item = {**candidate, 'box': after_box, 'bbox_after': after_box, 'bbox_before': before_box}
            duplicate = next((old for old in objects if old['change_type'] == item['change_type']
                and old['category'] == item['category'] and (overlap(old['box'], after_box)[0] >= .6
                or overlap(old['box'], after_box)[1] >= .9)), None)
            if duplicate is None:
                objects.append(item)
    return objects, evidence
