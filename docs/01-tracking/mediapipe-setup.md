# MediaPipe Setup — Face + Pose + Hand

> Setup 3 landmarker chạy đồng thời trên webcam, parse hand handedness (mirror correction), throttling khi performance thấp.

**When to read**: Phase 1 — trước khi viết `tracking_manager.js`. Hoặc khi cần thêm/sửa MediaPipe config.

---

## Tổng quan

| Landmarker | Model file | Output | Dùng cho |
|-----------|-----------|--------|---------|
| `FaceLandmarker` | `face_landmarker.task` | 478 landmark + 52 blendshape + 4×4 transform | Mặt, đầu, mắt, miệng |
| `PoseLandmarker` | `pose_landmarker_lite.task` | 33 landmark (normalized + worldLandmarks) | Thân, vai, hông, tay, chân |
| `HandLandmarker` | `hand_landmarker.task` | 21 landmark × ≤2 tay + handedness | Ngón tay |

---

## 1. Import + CDN

```js
import {
  FaceLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js";
```

---

## 2. Khởi tạo FilesetResolver (dùng chung)

```js
// Gọi 1 lần, dùng cho cả 3 landmarker
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);
```

---

## 3. FaceLandmarker

```js
const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
});
```

Output mỗi frame:

```js
const faceResult = faceLandmarker.detectForVideo(video, timestamp);
// faceResult.faceLandmarks[0]                  → Array<{x,y,z}> 478 điểm
// faceResult.faceBlendshapes[0].categories     → Array<{categoryName, score}>
// faceResult.facialTransformationMatrixes[0]   → Float32Array 4×4
```

---

## 4. PoseLandmarker

```js
const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,         // tắt để tiết kiệm GPU
});
```

Output:

```js
const poseResult = poseLandmarker.detectForVideo(video, timestamp);
// poseResult.landmarks[0]      → 33 điểm normalized [0,1]
// poseResult.worldLandmarks[0] → 33 điểm meters thực tế (gốc tại hips)
```

> **Quan trọng**: Ưu tiên `worldLandmarks` cho tính 3D — đơn vị mét, không phụ thuộc kích thước video.
> Chỉ dùng `landmarks` (normalized) khi cần biết pixel trên màn hình.

---

## 5. HandLandmarker

```js
const handLandmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
```

Output:

```js
const handResult = handLandmarker.detectForVideo(video, timestamp);
// handResult.landmarks[i]      → 21 điểm normalized
// handResult.worldLandmarks[i] → 21 điểm meters
// handResult.handedness[i]     → [{categoryName: "Left"|"Right", score}]
```

> ⚠️ **Mirror**: Webcam selfie → handedness bị **đảo**: `"Left"` thực ra là tay phải của user. Xem §9.

---

## 6. Video loop — Chạy 3 landmarker cùng nhau

```js
let lastVideoTime = -1;

function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (!video || video.readyState < 2) return;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;       // chỉ process khi có frame mới
  lastVideoTime = video.currentTime;

  // Chạy cả 3 đồng bộ (blocking) trong rAF
  trackingState.face = faceLandmarker.detectForVideo(video, now);
  trackingState.pose = poseLandmarker.detectForVideo(video, now);
  trackingState.hand = handLandmarker.detectForVideo(video, now);
}
```

> **Performance**: GPU trung bình (RTX 3060) cả 3 ~8–15ms/frame.
> Lag → giảm về `pose_landmarker_lite`, tắt HandLandmarker khi tay không trong frame.

---

## 7. Throttling khi performance thấp

```js
let frameCount = 0;
function detectLoop() {
  requestAnimationFrame(detectLoop);
  frameCount++;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // Face quan trọng nhất → mỗi frame
  trackingState.face = faceLandmarker.detectForVideo(video, now);

  // Pose + Hand → mỗi 2 frame
  if (frameCount % 2 === 0) {
    trackingState.pose = poseLandmarker.detectForVideo(video, now);
    trackingState.hand = handLandmarker.detectForVideo(video, now);
  }
}
```

---

## 8. TrackingState object

```js
const trackingState = {
  // Raw results
  face: null,
  faceDetected: false,
  pose: null,
  poseDetected: false,
  hand: null,
  leftHandDetected: false,
  rightHandDetected: false,
  leftHandLandmarks: null,                    // Array<{x,y,z}> 21 điểm
  rightHandLandmarks: null,

  // Processed (sau khi parse)
  headEuler:     { yaw: 0, pitch: 0, roll: 0 },
  eyeLeft:       { yaw: 0, pitch: 0 },
  eyeRight:      { yaw: 0, pitch: 0 },
  spineInput:    { leanPitch: 0, leanRoll: 0 },
  leftWristPos:  new THREE.Vector3(),
  rightWristPos: new THREE.Vector3(),
  leftAnklePos:  new THREE.Vector3(),
  rightAnklePos: new THREE.Vector3(),
};
```

---

## 9. Parse Hand Result — tách trái/phải (mirror correction)

```js
function parseHandResult(handResult, state) {
  state.leftHandDetected  = false;
  state.rightHandDetected = false;
  if (!handResult?.landmarks) return;

  for (let i = 0; i < handResult.landmarks.length; i++) {
    const handedness = handResult.handedness[i]?.[0]?.categoryName;

    // SWAP do mirror: "Left" của camera là tay PHẢI của user
    if (handedness === "Left") {
      state.rightHandLandmarks = handResult.worldLandmarks[i];
      state.rightHandDetected  = true;
    } else {
      state.leftHandLandmarks  = handResult.worldLandmarks[i];
      state.leftHandDetected   = true;
    }
  }
}
```

---

## 10. Confidence check

```js
function isPoseLandmarkVisible(landmark, threshold = 0.6) {
  return landmark?.visibility >= threshold;
}

const lWrist = poseResult.worldLandmarks[0]?.[15];
if (isPoseLandmarkVisible(lWrist)) {
  // Dùng landmark
} else {
  // Fallback idle target
}
```

---

## Lưu ý quan trọng

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Khởi tạo chậm (~1–2s) | Download WASM + model | Hiển thị loading screen, đợi `Promise` |
| `detectForVideo` ném lỗi timestamp | Timestamp giảm hoặc bằng 0 | Luôn `performance.now()` |
| Hand đổi trái/phải | Selfie mirror | Swap dựa trên handedness (§9) |
| Pose chỉ detect từ eo trở lên | Người quá gần camera | Lùi camera / dùng pose_landmarker_lite |
| GPU OOM | Chạy cả 3 cùng lúc | Tắt HandLandmarker khi không cần |

---

← Prev: [../00-overview/plan.md](../00-overview/plan.md) | **Up**: [README](../README.md) | Next: [face-tracking.md →](face-tracking.md)
