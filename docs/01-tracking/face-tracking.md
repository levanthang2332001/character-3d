# Face Tracking — MediaPipe FaceLandmarker integration

> File `script/face_mesh.js` tích hợp **MediaPipe FaceLandmarker** để tracking khuôn mặt từ webcam và điều khiển 3D face model (morph target + head rotation).

**When to read**: muốn hiểu/sửa face tracking, head pose math, blendshape mapping, hoặc fix mirror.

---

## Flow

```
Webcam → MediaPipe FaceLandmarker → Landmarks + Blendshapes → Map to Morph Targets + Head Pose
```

## 1. MediaPipe setup

```js
FaceLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL, delegate: "GPU" },
  runningMode: "VIDEO",
  numFaces: 1,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
});
```

- **Model**: `face_landmarker.task` (float16, ~2.5MB)
- **Delegate**: thử GPU trước, fallback CPU
- **Output**: 52 blendshape + 478 landmark per face

## 2. Face landmark indices

478 = 468 mesh + 10 iris. Key landmarks cho head pose:

| Landmark | Index | Purpose |
|----------|-------|---------|
| Nose tip | 1 | Reference point |
| Left eye inner | 33 | Eye tracking |
| Left eye outer | 133 | Eye tracking |
| Right eye inner | 362 | Eye tracking |
| Right eye outer | 263 | Eye tracking |

> "Left" / "Right" ở đây là **camera space** (selfie cam đảo). Xem [glossary §16](../00-overview/glossary.md#16-quy-ước-lr--tráiphải).

## 3. Head pose calculation

### Yaw (quay trái/phải)

```js
rawYaw = (nose.x - eyeCenter.x) / (eyeDistance * 0.8)
```

- `nose.x` offset từ eye center.
- `eyeDistance` = khoảng cách 2 mắt (scale factor).
- Negate vì webcam mirror.

### Pitch (ngước/cúi)

```js
pitchDiff = -(nose.y - eyeCenter.y)
rawPitch  = pitchDiff / (eyeDistance * 2.5)
```

- Vertical offset giữa nose và eye center.
- Denominator `2.5` lớn để giảm sensitivity.
- Negate đảo chiều.

### Roll (nghiêng đầu)

```js
rawRoll = atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 0.5
```

- Góc đường nối 2 mắt.
- Negate cho mirrored webcam.

## 4. Blendshape mapping

MediaPipe blendshapes → Morph target names:

```js
const blendshapeMap = {
  browDownLeft:   "browDown_L",
  browInnerUp:    "browInnerUp",
  eyeBlinkLeft:   "eyeBlink_L",
  jawOpen:        "jawOpen",
  mouthSmileLeft: "mouthSmile_L",
  // ... 52 blendshape
};
```

> ⚠️ Khi map sang model, có thể phải **đảo L/R** vì mirror. Xem [glossary §13](../00-overview/glossary.md#13-blendshape--morph-target).

## 5. Smoothing

```js
state.headEuler.yaw   = lerp(state.headEuler.yaw,   -rawYaw   * 0.8, 0.30);
state.headEuler.pitch = lerp(state.headEuler.pitch, -rawPitch * 0.5, 0.30);
state.headEuler.roll  = lerp(state.headEuler.roll,   rawRoll,        0.25);
```

Dùng `THREE.MathUtils.lerp` tránh jitter.

## Common issues

### 1. Pitch luôn ±1 (stuck)

- **Cause**: Denominator quá nhỏ (0.35).
- **Fix**: Tăng lên 2.0–2.5.

### 2. Đầu quay ngược hướng

- **Cause**: Webcam mirror.
- **Fix**: Negate yaw + roll, swap left/right eye index.

### 3. Face not detected

- Check camera permission.
- Check ánh sáng.
- Giảm `minFaceDetectionConfidence`.

### 4. Lỗi "Could not establish connection"

- Chrome extension error, ignore — không ảnh hưởng functionality.

## Mirror correction summary

Selfie webcam đảo:

| Normal | Mirror correction |
|--------|-------------------|
| `leftEye = [33, 133]` | `leftEye = [362, 263]` |
| `rightEye = [362, 263]` | `rightEye = [33, 133]` |
| `rawYaw` | `-rawYaw` |
| `rawPitch` | `-rawPitch` |
| `rawRoll` | `-rawRoll` |

## Dependencies

- `@mediapipe/tasks-vision` (MediaPipe Vision tasks)
- `three` (Three.js for lerp + rotation)
- `./facecap.js` (morph target functions)

---

← Prev: [mediapipe-setup.md](mediapipe-setup.md) | **Up**: [README](../README.md) | Next: [../02-rig/model-setup.md →](../02-rig/model-setup.md)
