#!/usr/bin/env python3
"""AI 超分：OpenCV FSRCNN 2x 超分辨率"""
import cv2, sys, os
os.environ['OPENCV_IO_MAX_IMAGE_PIXELS'] = '50000000'
cv2.setNumThreads(1)

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'FSRCNN_x2.pb')

def upscale(input_path, output_path):
    if not os.path.exists(MODEL):
        print(f"ERROR: model not found at {MODEL}", file=sys.stderr); sys.exit(1)
    img = cv2.imread(input_path)
    if img is None:
        print(f"ERROR: cannot read {input_path}", file=sys.stderr); sys.exit(1)
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(MODEL)
    sr.setModel("fsrcnn", 2)
    result = sr.upsample(img)
    cv2.imwrite(output_path, result, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"OK: {img.shape[1]}x{img.shape[0]} -> {result.shape[1]}x{result.shape[0]}")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input> <output>", file=sys.stderr); sys.exit(1)
    upscale(sys.argv[1], sys.argv[2])
