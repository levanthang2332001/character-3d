# Face Tracking - MediaPipe Integration

## Overview

File `face_mesh.js` tích hợp **MediaPipe Face Landmarker** để tracking khuôn mặt từ webcam và điều khiển 3D face model (morph targets + head rotation).

## Flow

```
Webcam → MediaPipe FaceLandmarker → Landmarks + Blendshapes → Map to Morph Targets + Head Pose
```

## Components

### 1. MediaPipe Setup

```javascript
FaceLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL, delegate: "GPU" },
  runningMode: "VIDEO",
  numFaces: 1,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
});
```

- **Model**: `face_landmarker.task` (float16, ~2.5MB)
- **Delegate**: Thử GPU trước, fallback CPU
- **Output**: 52 blendshapes + 478 landmarks per face

### 2. Face Landmark Indices

MediaPipe Face Mesh 468 landmarks. Key landmarks dùng cho head pose:


| Landmark        | Index | Purpose         |
| --------------- | ----- | --------------- |
| Nose tip        | 1     | Reference point |
| Left eye inner  | 33    | Eye tracking    |
| Left eye outer  | 133   | Eye tracking    |
| Right eye inner | 362   | Eye tracking    |
| Right eye outer | 263   | Eye tracking    |


### 3. Head Pose Calculation

#### Yaw (quay trái/phải)

```javascript
rawYaw = (nose.x - eyeCenter.x) / (eyeDistance * 0.8)
```

- nose.x offset từ eye center
- eyeDistance là khoảng cách 2 mắt (dùng làm scale factor)
- Negate vì webcam mirrored

#### Pitch (ngước/cúi)

```javascript
pitchDiff = -(nose.y - eyeCenter.y)
rawPitch = pitchDiff / (eyeDistance * 2.5)
```

- Dùng vertical offset giữa nose và eye center
- 2.5 là denominator lớn để giảm sensitivity
- Negate để đảo chiều

#### Roll (nghiêng đầu)

```javascript
rawRoll = atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 0.5
```

- Tính góc của đường nối 2 mắt
- Negate cho mirrored webcam

### 4. Blendshape Mapping

MediaPipe blendshapes → Morph target names:

```javascript
const blendshapeMap = {
  browDownLeft: "browDown_L",
  browInnerUp: "browInnerUp",
  eyeBlinkLeft: "eyeBlink_L",
  jawOpen: "jawOpen",
  mouthSmileLeft: "mouthSmile_L",
  // ... 52 blendshapes
}
```

### 5. Smoothing

```javascript
state.headEuler.yaw = lerp(state.headEuler.yaw, -rawYaw * 0.8, 0.3)
state.headEuler.pitch = lerp(state.headEuler.pitch, -rawPitch * 0.5, 0.3)
state.headEuler.roll = lerp(state.headEuler.roll, rawRoll, 0.25)
```

Dùng `THREE.MathUtils.lerp` để smoothing values, tránh jitter.

## Common Issues

### 1. Pitch always ±1 (stuck)

- **Cause**: Denominator quá nhỏ (0.35)
- **Fix**: Tăng lên 2.0-2.5

### 2. Head quay ngược hướng

- **Cause**: Webcam mirrored
- **Fix**: Negate yaw và roll, swap left/right eye indices

### 3. Face not detected

- Check camera permissions
- Check lighting
- Lower `minFaceDetectionConfidence`

### 4. Error: "Could not establish connection"

- Chrome extension error, ignore - không ảnh hưởng functionality

## Mirror Correction Summary

Vì webcam selfie mode đảo ngược:


| Normal                | Mirror Correction    |
| --------------------- | -------------------- |
| leftEye = [33, 133]   | leftEye = [362, 263] |
| rightEye = [362, 263] | rightEye = [33, 133] |
| rawYaw                | -rawYaw              |
| rawPitch              | -rawPitch            |
| rawRoll               | -rawRoll             |


## Dependencies

- `@mediapipe/tasks-vision` (MediaPipe Vision tasks)
- `three` (Three.js for lerp và rotation)
- `./facecap.js` (morph target functions)

