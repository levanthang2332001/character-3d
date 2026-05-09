---
name: mediapipe-tracking
description: Setup và parse 3 MediaPipe landmarker (Face / Pose / Hand) chạy đồng thời trên webcam — bao gồm mirror correction cho selfie cam (handedness bị đảo), throttling khi performance thấp, confidence check, và shared trackingState object. Use this when the user asks về MediaPipe init, FaceLandmarker / PoseLandmarker / HandLandmarker, "tay trái thành tay phải", landmark index, blendshape categories, hoặc khi cần thêm tracking source mới.
---

# MediaPipe Tracking — 3 Landmarker đồng thời

## Khi dùng skill này

Bất cứ khi đụng tới `FaceLandmarker`, `PoseLandmarker`, `HandLandmarker`, parse landmark, blendshape, hoặc chuyển coords từ camera → world.

## Tổng quan

| Landmarker | Output | Dùng cho |
|-----------|--------|---------|
| Face | 478 landmarks + 52 blendshape + 4×4 transform matrix | Mặt, đầu, mắt, miệng |
| Pose | 33 landmarks (normalized + worldLandmarks meters) | Thân, vai, hông, tay, chân |
| Hand | 21 landmarks × ≤2 tay + handedness | Ngón tay |

## Setup chung

```js
import {
  FaceLandmarker, PoseLandmarker, HandLandmarker, FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js";

// Gọi 1 lần, share cho cả 3
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);
```

Mỗi landmarker tạo `createFromOptions(vision, { baseOptions: { modelAssetPath, delegate: "GPU" }, runningMode: "VIDEO", ... })`. Xem `docs/01-tracking/mediapipe-setup.md` cho config đầy đủ.

## Pattern: trackingState object

State chia sẻ giữa MediaPipe loop và character controller:

```js
const trackingState = {
  // Raw results
  face: null, pose: null, hand: null,
  faceDetected: false, poseDetected: false,
  leftHandDetected: false, rightHandDetected: false,
  leftHandLandmarks: null, rightHandLandmarks: null,

  // Processed (sau parse)
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

## Detection loop

```js
let lastVideoTime = -1;

function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (!video || video.readyState < 2) return;

  if (video.currentTime === lastVideoTime) return;      // chỉ process khi có frame mới
  lastVideoTime = video.currentTime;

  const now = performance.now();
  trackingState.face = faceLandmarker.detectForVideo(video, now);
  trackingState.pose = poseLandmarker.detectForVideo(video, now);
  trackingState.hand = handLandmarker.detectForVideo(video, now);
}
```

> Timestamp phải tăng đơn điệu — luôn dùng `performance.now()`. Truyền `0` hoặc giảm sẽ ném lỗi.

## ⚠️ Mirror correction — handedness ĐẢO

Webcam selfie đảo ảnh ngang trước khi vào MediaPipe → `handedness: "Left"` thực chất là **tay phải** của người dùng:

```js
function parseHandResult(handResult, state) {
  state.leftHandDetected  = false;
  state.rightHandDetected = false;
  if (!handResult?.landmarks) return;

  for (let i = 0; i < handResult.landmarks.length; i++) {
    const handedness = handResult.handedness[i]?.[0]?.categoryName;
    // SWAP do mirror
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

Tương tự cho yaw/roll trong head pose: thường phải `negate`. Xem `docs/01-tracking/face-tracking.md` mục "Mirror Correction Summary".

## Convert Pose worldLandmarks → Three.js world

`worldLandmarks` đơn vị mét, gốc tại hips:

```js
const scaleV = (lm, sign = 1) => new THREE.Vector3(
  -lm.x * worldScale.x * sign,                          // mirror X
   lm.y * worldScale.y,
  -lm.z * worldScale.z,                                 // negate Z (camera nhìn vào -Z)
);
```

`worldScale` tính từ `computeWorldScale(bones, boneLengths)` — xem skill `character-rig`.

Index quan trọng (Pose):
- `15` = L_Wrist, `16` = R_Wrist (cho arm IK target)
- `27` = L_Ankle, `28` = R_Ankle (cho leg IK target)
- `11`/`12` shoulders, `23`/`24` hips (cho spine lean)

## Confidence check

```js
function isPoseLandmarkVisible(lm, threshold = 0.6) {
  return lm?.visibility >= threshold;
}

if (isPoseLandmarkVisible(wl[15])) {
  trackingState.leftWristPos = scaleV(wl[15]);
}
// Else: giữ giá trị cũ hoặc fallback idle target — không update với data thiếu tin cậy.
```

## Throttling khi FPS drop

Face quan trọng nhất → mỗi frame; Pose + Hand → mỗi 2 frame:

```js
let frameCount = 0;
function detectLoop() {
  frameCount++;
  trackingState.face = faceLandmarker.detectForVideo(video, now);
  if (frameCount % 2 === 0) {
    trackingState.pose = poseLandmarker.detectForVideo(video, now);
    trackingState.hand = handLandmarker.detectForVideo(video, now);
  }
}
```

## Khởi động chậm — UX

3 landmarker tải ~5–8MB WASM + model lần đầu (1–2s). Hiện loading screen, đợi `Promise.all(...)` xong rồi mới bật detect loop.

## Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|-------------|-------------|-----|
| Tay trái/phải bị tráo | Quên mirror swap handedness | Pattern §"Mirror correction" |
| Pose chỉ detect nửa người trên | Camera quá gần | Lùi camera hoặc dùng pose_landmarker_lite |
| `detectForVideo` ném lỗi timestamp | Timestamp giảm hoặc bằng 0 | Luôn `performance.now()` |
| GPU OOM | 3 model cùng GPU delegate | Tắt Hand khi không thấy tay; hoặc 1 lite + 2 GPU |
| Face không detect | Permission / lighting | Kiểm tra getUserMedia + giảm `minFaceDetectionConfidence` về 0.3 |

## Reference

- Doc full: `docs/01-tracking/mediapipe-setup.md`, `docs/01-tracking/face-tracking.md`.
- Code đang chạy (face only): `script/face_mesh.js`, `script/face_tracking_utils.js`.
- Pose + Hand chưa tích hợp — đang ở Phase 1 trong `docs/00-overview/plan.md`.
