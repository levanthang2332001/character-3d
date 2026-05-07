# MediaPipe Setup — Face + Pose + Hands

## Tổng quan

HoloBox character cần 3 MediaPipe landmarker chạy đồng thời:

| Landmarker | Model file | Output | Dùng cho |
|-----------|-----------|--------|---------|
| `FaceLandmarker` | `face_landmarker.task` | 478 landmarks + 52 blendshapes | Mặt, đầu, mắt, miệng |
| `PoseLandmarker` | `pose_landmarker_lite.task` | 33 landmarks (world + normalized) | Thân, vai, hông, tay, chân |
| `HandLandmarker` | `hand_landmarker.task` | 21 landmarks × 2 tay | Ngón tay |

---

## 1. Import và CDN

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
// Gọi một lần duy nhất, dùng cho tất cả landmarkers
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
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

**Output của mỗi frame:**
```js
const faceResult = faceLandmarker.detectForVideo(video, timestamp);
// faceResult.faceLandmarks[0]        → Array<{x,y,z}> 478 điểm
// faceResult.faceBlendshapes[0].categories → Array<{categoryName, score}>
// faceResult.facialTransformationMatrixes[0] → Float32Array 4x4
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
  outputSegmentationMasks: false,  // tắt để tiết kiệm GPU
});
```

**Output của mỗi frame:**
```js
const poseResult = poseLandmarker.detectForVideo(video, timestamp);
// poseResult.landmarks[0]        → Array<{x,y,z,visibility}> 33 điểm — normalized [0,1]
// poseResult.worldLandmarks[0]   → Array<{x,y,z,visibility}> 33 điểm — meters, gốc ở hips
```

> **Quan trọng**: Ưu tiên dùng `worldLandmarks` cho tính toán 3D — đơn vị là **meters** thực tế,
> không phụ thuộc vào kích thước video frame. Chỉ dùng `landmarks` (normalized) khi cần biết
> vị trí pixel trên màn hình.

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

**Output của mỗi frame:**
```js
const handResult = handLandmarker.detectForVideo(video, timestamp);
// handResult.landmarks[i]     → Array<{x,y,z}> 21 điểm — normalized
// handResult.worldLandmarks[i]→ Array<{x,y,z}> 21 điểm — meters
// handResult.handedness[i]    → [{categoryName: "Left"|"Right", score}]
```

> **Chú ý mirror**: Webcam selfie → MediaPipe nhận ảnh đã mirror →
> `handedness` bị đảo: "Left" thực ra là tay phải của người dùng.
> Cần swap: `if (handedness === "Left") → rightHand, else → leftHand`

---

## 6. Video Loop — Chạy 3 Landmarkers cùng nhau

```js
let lastVideoTime = -1;

function detectLoop() {
  requestAnimationFrame(detectLoop);

  if (!video || video.readyState < 2) return;

  const now = performance.now();

  // Chỉ process khi có frame mới
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // Chạy cả 3 — đồng bộ (blocking) trong requestAnimationFrame
  const faceResult = faceLandmarker.detectForVideo(video, now);
  const poseResult = poseLandmarker.detectForVideo(video, now);
  const handResult = handLandmarker.detectForVideo(video, now);

  // Lưu vào state dùng chung
  trackingState.face = faceResult;
  trackingState.pose = poseResult;
  trackingState.hand = handResult;
}
```

> **Performance note**: Trên GPU trung bình (RTX 3060), cả 3 landmarkers ~8–15ms/frame.
> Nếu lag, giảm về `pose_landmarker_lite` và tắt HandLandmarker khi tay không trong frame.

---

## 7. Throttling khi performance thấp

```js
// Chạy Pose + Hand mỗi 2 frames thay vì mỗi frame
let frameCount = 0;
function detectLoop() {
  requestAnimationFrame(detectLoop);
  frameCount++;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // Face luôn chạy mỗi frame (quan trọng nhất)
  trackingState.face = faceLandmarker.detectForVideo(video, now);

  // Pose + Hand chạy mỗi 2 frames
  if (frameCount % 2 === 0) {
    trackingState.pose = poseLandmarker.detectForVideo(video, now);
    trackingState.hand = handLandmarker.detectForVideo(video, now);
  }
}
```

---

## 8. TrackingState Object

```js
// State dùng chung giữa MediaPipe và character controller
const trackingState = {
  // Face
  face: null,     // FaceLandmarkerResult
  faceDetected: false,

  // Pose
  pose: null,     // PoseLandmarkerResult
  poseDetected: false,

  // Hands
  hand: null,     // HandLandmarkerResult
  leftHandDetected: false,
  rightHandDetected: false,
  leftHandLandmarks: null,   // Array<{x,y,z}> 21 points
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

## 9. Parse Hand Result (tách trái/phải)

```js
function parseHandResult(handResult, state) {
  state.leftHandDetected  = false;
  state.rightHandDetected = false;

  if (!handResult?.landmarks) return;

  for (let i = 0; i < handResult.landmarks.length; i++) {
    const handedness = handResult.handedness[i]?.[0]?.categoryName;

    // Mirror correction: selfie camera → "Left" là tay PHẢI thực tế
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

## 10. Confidence Check

```js
function isPoseLandmarkVisible(landmark, threshold = 0.6) {
  return landmark?.visibility >= threshold;
}

// Ví dụ khi lấy wrist target:
const lWrist = poseResult.worldLandmarks[0]?.[15];
if (isPoseLandmarkVisible(lWrist)) {
  // Dùng landmark
} else {
  // Fallback về idle target
}
```

---

## Lưu ý quan trọng

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| MediaPipe khởi tạo chậm (~1-2s) | Download WASM + model | Hiển thị loading screen, chờ Promise |
| `detectForVideo` bị lỗi timestamp | Timestamp giảm hoặc bằng 0 | Luôn dùng `performance.now()` |
| Hand bị đổi trái/phải | Selfie mirror | Swap dựa trên handedness như mục 9 |
| Pose chỉ detect từ eo lên | Người đứng quá xa camera | Dùng full-body camera, hoặc dùng chế độ LITE |
| GPU out of memory | Chạy cả 3 landmarkers cùng lúc | Tắt HandLandmarker khi không cần |
