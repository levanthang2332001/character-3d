import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  clearLipSyncCameraSignal,
  getMorphTargetDictionary,
  isLipSyncActive,
  resetAll,
  setEyeRotation,
  setHeadRotation,
  setMorphTarget,
  updateLipSyncCameraSignal,
} from "./facecap.js";
import {
  BLENDSHAPE_MAP,
  EYE_LOOK_TARGETS,
  EYE_LOOK_TARGET_SET,
  BROW_MORPH_SCALE,
  LIP_SYNC_MORPH_TARGET_SET,
  clearOverlay,
  createEyeLookFilters,
  createEyeLookFromLandmarks,
  createHeadGazeBias,
  createHeadPoseFromLandmarks,
  drawFaceFrameOverlay,
  extractCameraMouthSignal,
  syncOverlaySize,
} from "./face_tracking_utils.js";

const MEDIAPIPE_WASM_ROOT = "./node_modules/@mediapipe/tasks-vision/wasm";
const MEDIAPIPE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const FACE_TRACKING_CONFIG = {
  video: {
    facingMode: "user",           // camera trước (selfie)
    width: { ideal: 640 },
    height: { ideal: 480 },
  },
  detection: {
    minFaceDetectionConfidence: 0.5,  // ngưỡng tin cậy để detect mặt
    minFacePresenceConfidence: 0.5,  // ngưỡng để xác nhận mặt đang hiện diện
    minTrackingConfidence: 0.5,  // ngưỡng để tiếp tục tracking mà không detect lại
  },
};

// ─── State của module ─────────────────────────────────────────────────────────

const state = {
  // DOM elements
  trackingButton: null,
  trackingStatus: null,
  cameraPreview: null,   
  cameraOverlay: null,   
  overlayContext: null,   

  // MediaPipe
  faceLandmarker: null,   // instance FaceLandmarker (lazy-loaded)
  trackingAnimationFrame: null, // ID của requestAnimationFrame đang chạy
  cameraStream: null,   // MediaStream từ getUserMedia

  // Trạng thái tracking
  isTracking: false,
  lastVideoTime: -1,       // thời điểm frame video cuối đã xử lý (tránh xử lý lại frame cũ)

  // Smooth values: lưu giá trị đã lerp của từng morph target
  smoothedValues: {},      // { "jawOpen": 0.23, "mouthSmile_L": 0.7, ... }

  // Head pose: góc Euler hiện tại (được cập nhật qua lerp)
  headEuler: { pitch: 0, yaw: 0, roll: 0 },

  // Eye neutral calibration
  eyeNeutral:        null,   // { leftPitch, leftYaw, rightPitch, rightYaw }
  eyeNeutralSamples: [],

  // Eye smoothing
  eyeSmooth: { leftPitch: 0, leftYaw: 0, rightPitch: 0, rightYaw: 0 },

  // Eye look: One Euro Filter state cho cả hai mắt (tạo lại mỗi khi bắt đầu tracking)
  eyeFilters: null,

  // Debug panel
  debugEl:      null,
  debugVisible: false,
  /** Snapshot số học mới nhất cho nút Copy (cập nhật mỗi frame khi có face) */
  lastEyeDebugSnapshot: null,
};

export function initFaceTracking() {
  state.trackingButton = document.getElementById("tracking");
  state.trackingStatus = document.getElementById("tracking-status");
  state.cameraPreview = document.getElementById("camera-preview");
  state.cameraOverlay = document.getElementById("camera-overlay");
  state.overlayContext = state.cameraOverlay?.getContext("2d") ?? null;
  setTrackingStatus("Camera idle");
  createDebugPanel();
}

export function toggleEyeDebugPanel() {
  state.debugVisible = !state.debugVisible;
  if (state.debugEl) state.debugEl.style.display = state.debugVisible ? "block" : "none";
}

/**
 * Reset neutral calibration — dùng khi user muốn calibrate lại.
 * Nhìn thẳng vào camera rồi gọi hàm này (hoặc bấm nút Recalibrate trong GUI).
 * 15 frame tiếp theo sẽ được thu mẫu làm neutral mới.
 */
export function recalibrateEye() {
  state.eyeNeutral = null;
  state.eyeNeutralSamples = [];
  state.eyeFilters = createEyeLookFilters(); // reset filter để tránh stale state
}

export async function toggleFaceTracking() {
  if (state.isTracking) {
    stopFaceTracking();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setTrackingStatus("Browser does not support camera API.");
    return;
  }

  try {
    setTrackingStatus("Opening camera...");

    // Mở camera stream
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: FACE_TRACKING_CONFIG.video,
      audio: false,
    });

    state.cameraPreview.srcObject = state.cameraStream;
    await state.cameraPreview.play();
    syncOverlaySize(state.cameraOverlay, state.cameraPreview);

    // Load model MediaPipe (lazy, chỉ load lần đầu)
    await ensureFaceLandmarker();

    // Reset state về giá trị khởi đầu
    state.isTracking = true;
    state.lastVideoTime = -1;
    state.smoothedValues = {};
    state.headEuler = { pitch: 0, yaw: 0, roll: 0 };
    state.eyeNeutral = null;
    state.eyeNeutralSamples = [];
    state.eyeFilters = createEyeLookFilters(); // tạo mới filter state mỗi lần bắt đầu
    setHeadRotation(0, 0, 0);
    setEyeRotation(0, 0, 0, 0);
    setTrackingButtonState(true);
    setTrackingStatus("Camera live. Tracking face...");

    // Khởi động vòng lặp tracking
    state.trackingAnimationFrame = requestAnimationFrame(trackFaceFrame);
  } catch (error) {
    console.error(error);
    stopCameraStream();
    setTrackingButtonState(false);
    setTrackingStatus("Cannot open camera or model tracking.");
  }
}

/**
 * Dừng face tracking hoàn toàn:
 * hủy animation frame, đóng camera stream, reset avatar về neutral.
 */
export function stopFaceTracking() {
  state.isTracking = false;

  if (state.trackingAnimationFrame) {
    cancelAnimationFrame(state.trackingAnimationFrame);
    state.trackingAnimationFrame = null;
  }

  stopCameraStream();
  clearTrackedPose();
  resetAll();
  setTrackingButtonState(false);
  setTrackingStatus("Camera idle");
}

async function ensureFaceLandmarker() {
  if (state.faceLandmarker) return state.faceLandmarker;

  setTrackingStatus("Loading face tracker...");

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

  // Factory function để tạo options với delegate thay đổi được
  const createOptions = (delegate) => ({
    baseOptions: {
      modelAssetPath: MEDIAPIPE_MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO",   // mode video (khác với "IMAGE" là xử lý từng ảnh)
    numFaces: 1,         // chỉ tracking 1 mặt
    outputFaceBlendshapes: true,      // cần blendshapes cho morph targets
    outputFacialTransformationMatrixes: true,  // không dùng trực tiếp nhưng hỗ trợ model
    ...FACE_TRACKING_CONFIG.detection,
  });

  try {
    state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, createOptions("GPU"));
  } catch (error) {
    console.warn("Falling back to CPU delegate for face tracking.", error);
    state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, createOptions("CPU"));
  }

  return state.faceLandmarker;
}

function trackFaceFrame() {
  if (!state.isTracking) {
    state.trackingAnimationFrame = null;
    return;
  }

  if (!state.faceLandmarker || !state.cameraPreview || state.cameraPreview.readyState < 2) {
    state.trackingAnimationFrame = requestAnimationFrame(trackFaceFrame);
    return;
  }

  if (state.cameraPreview.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = state.cameraPreview.currentTime;
    const result = state.faceLandmarker.detectForVideo(state.cameraPreview, performance.now());
    applyTrackingResult(result);
  }

  state.trackingAnimationFrame = requestAnimationFrame(trackFaceFrame);
}

// ─── Private: Apply Tracking Results ─────────────────────────────────────────

/**
 * Áp kết quả detect từ MediaPipe lên avatar.
 * Nếu không detect được mặt → decay về 0 thay vì giật cứng.
 *
 * @param {FaceLandmarkerResult} result - Kết quả từ MediaPipe detectForVideo
 */
function applyTrackingResult(result) {
  const categories = result?.faceBlendshapes?.[0]?.categories ?? [];
  const landmarks = result?.faceLandmarks?.[0] ?? null;

  if (!categories.length) {
    clearLipSyncCameraSignal();
    decayTrackedValues();
    clearOverlay(state.overlayContext, state.cameraOverlay);
    setTrackingStatus("No face detected in the frame.");
    return;
  }

  const morphDictionary = getMorphTargetDictionary();
  const seenTargets = new Set();
  const lipSyncActive = isLipSyncActive();

  if (lipSyncActive) {
    updateLipSyncCameraSignal(extractCameraMouthSignal(categories));
  } else {
    clearLipSyncCameraSignal();
  }

  for (const category of categories) {
    const targetName = BLENDSHAPE_MAP[category.categoryName];
    if (!targetName || !(targetName in morphDictionary)) continue;

    // Bỏ qua morph liên quan đến miệng khi lip sync đang tự quản lý
    if (lipSyncActive && LIP_SYNC_MORPH_TARGET_SET.has(targetName)) continue;

    // Bỏ qua eye look targets — chúng ta tự tính từ iris bên dưới (applyEyeLookFromLandmarks)
    // Nếu để loop này chạy, giá trị sẽ bị ghi đè 2 lần → không nhất quán
    if (EYE_LOOK_TARGET_SET.has(targetName)) continue;

    // Giảm sensitivity của lông mày để tránh kéo chân mày khi trợn mắt.
    // Khi nhìn lên, cơ chân mày tự nhiên co nhẹ → MediaPipe detect và kéo brow morphs.
    // Nhân với BROW_SCALE để giảm tác động này.
    const scale = BROW_MORPH_SCALE[targetName] ?? 1.0;

    seenTargets.add(targetName);
    updateMorphTargetSmooth(targetName, category.score * scale);
  }

  // Các target không có trong frame này → lerp về 0 (không giật cứng)
  for (const targetName of Object.values(BLENDSHAPE_MAP)) {
    if (lipSyncActive && LIP_SYNC_MORPH_TARGET_SET.has(targetName)) continue;
    if (targetName in morphDictionary && !seenTargets.has(targetName)) {
      updateMorphTargetSmooth(targetName, 0);
    }
  }

  // Áp head pose và eye rotation từ landmarks 3D
  if (landmarks) {
    applyHeadPoseFromLandmarks(landmarks);
    applyEyeLookFromLandmarks(landmarks);
    drawFaceFrameOverlay(state.overlayContext, state.cameraOverlay, state.cameraPreview, landmarks);
  }

  setTrackingStatus("Tracking face live.");
}

// ─── Private: Smoothing ───────────────────────────────────────────────────────

/**
 * Cập nhật một morph target với lerp smoothing.
 * Lerp factor 0.35 = khá nhanh nhưng vẫn mượt.
 * Giá trị dưới 0.015 được làm tròn về 0 (tránh micro-jitter).
 *
 * @param {string} name      - Tên morph target
 * @param {number} nextValue - Giá trị đích [0, 1]
 */
/** Lerp nhanh hơn cho eye look morphs — Char bám sát You trong debug panel */
const EYE_LOOK_MORPH_LERP = 0.78;

/** Giới hạn góc bone — phải trùng `eye_control.js` (`applyEyeRotation` clamp) */
const EYE_YAW_LIMIT = 0.72;
const EYE_PITCH_LIMIT = 0.28;

// Baseline eyeLookUp để bù iris người tự nhiên nằm hơi dưới tâm hình học.
// Áp vào morph (mesh deformation) thay vì bone → tự nhiên, đối xứng cả 2 mắt.
// TUNING: tăng nếu còn hở trên, giảm nếu mắt bị kéo lên quá.
const EYE_UP_MORPH_REST = 0.12;

// Bù residual pitch sau neutral calibration (neutral không capture đúng 100%
// nếu user chưa nhìn thẳng lúc 15 frame đầu).
// Âm = đẩy bone xuống (bù pitch dương dư). Cả L và R đều áp → không gây lệch.
// TUNING: đặt = -(giá trị L/R Pitch trung bình khi nhìn thẳng).
const EYE_PITCH_CORRECTION = -0.08;

function updateMorphTargetSmooth(name, nextValue, lerpFactor = 0.35) {
  const currentValue = state.smoothedValues[name] ?? 0;
  const clampedValue = THREE.MathUtils.clamp(nextValue, 0, 1);
  const smoothedValue = THREE.MathUtils.lerp(currentValue, clampedValue, lerpFactor);

  state.smoothedValues[name] = smoothedValue;
  setMorphTarget(name, smoothedValue < 0.015 ? 0 : smoothedValue);
}

/**
 * Dần dần trả tất cả giá trị về 0 khi mất tracking.
 * Lerp factor 0.25 = chậm hơn để fade out tự nhiên.
 */
function decayTrackedValues() {
  for (const name of Object.keys(state.smoothedValues)) {
    updateMorphTargetSmooth(name, 0);
  }

  // Decay head rotation
  state.headEuler.pitch = THREE.MathUtils.lerp(state.headEuler.pitch, 0, 0.25);
  state.headEuler.yaw = THREE.MathUtils.lerp(state.headEuler.yaw, 0, 0.25);
  state.headEuler.roll = THREE.MathUtils.lerp(state.headEuler.roll, 0, 0.25);

  // Decay eye smooth về neutral khi mất mặt
  state.eyeSmooth.leftPitch = THREE.MathUtils.lerp(state.eyeSmooth.leftPitch, 0, 0.15);
  state.eyeSmooth.leftYaw = THREE.MathUtils.lerp(state.eyeSmooth.leftYaw, 0, 0.15);
  state.eyeSmooth.rightPitch = THREE.MathUtils.lerp(state.eyeSmooth.rightPitch, 0, 0.15);
  state.eyeSmooth.rightYaw = THREE.MathUtils.lerp(state.eyeSmooth.rightYaw, 0, 0.15);

  setEyeRotation(
    state.eyeSmooth.leftPitch, state.eyeSmooth.leftYaw,
    state.eyeSmooth.rightPitch, state.eyeSmooth.rightYaw,
  );
  setHeadRotation(state.headEuler.pitch, state.headEuler.yaw, state.headEuler.roll);
}

// ─── Private: Head Pose ───────────────────────────────────────────────────────

/**
 * Tính và áp góc đầu từ landmarks.
 * Delegate việc tính toán sang face_tracking_utils.js.
 */
function applyHeadPoseFromLandmarks(landmarks) {
  state.headEuler = createHeadPoseFromLandmarks(landmarks, state.headEuler);
  setHeadRotation(state.headEuler.pitch, state.headEuler.yaw, state.headEuler.roll);
}

// ─── Private: Eye Look ────────────────────────────────────────────────────────

/**
 * Tính và áp hướng nhìn mắt từ vị trí iris trong landmarks.
 *
 * Logic:
 *  1. Lấy eye look weights (up/down/in/out + rotation pitch/yaw) từ iris
 *  2. Tính head gaze bias (offset nhỏ từ hướng đầu để mắt trông tự nhiên)
 *  3. Calibrate neutral: 12 frame đầu thu mẫu → tính trung bình → dùng làm offset
 *  4. Áp morph targets (4 hướng nhìn) + setEyeRotation (xoay bone 3D)
 *
 * @param {Array} landmarks - 478 điểm landmark
 */
function applyEyeLookFromLandmarks(landmarks) {

  const { left: leftEyeLook, right: rightEyeLook } = createEyeLookFromLandmarks(
    landmarks, state.eyeFilters, performance.now(),
  );

  const headGazeBias = createHeadGazeBias(state.headEuler);


  if (!leftEyeLook || !rightEyeLook) {
    for (const targetName of EYE_LOOK_TARGETS) {
      updateMorphTargetSmooth(targetName, 0);
    }
    setEyeRotation(
      headGazeBias.rotationPitch,
      headGazeBias.rotationYaw,
      headGazeBias.rotationPitch,
      headGazeBias.rotationYaw,
    );
    return;
  }

  updateEyeNeutral(leftEyeLook, rightEyeLook);

  // Trừ bỏ neutral offset để mắt không bị lệch khi nhìn thẳng
  const leftRotationPitch = leftEyeLook.rotationPitch - (state.eyeNeutral?.leftPitch ?? 0);
  const leftRotationYaw = leftEyeLook.rotationYaw - (state.eyeNeutral?.leftYaw ?? 0);
  const rightRotationPitch = rightEyeLook.rotationPitch - (state.eyeNeutral?.rightPitch ?? 0);
  const rightRotationYaw = rightEyeLook.rotationYaw - (state.eyeNeutral?.rightYaw ?? 0);

  // Áp morph targets hướng nhìn (4 hướng × 2 mắt = 8 morphs).
  // Trừ neutral để loại bỏ bias lên/xuống hệ thống khi nhìn thẳng.
  // clamp về [0,1] sau khi trừ — neutral chỉ shift gốc, không đảo hướng.
  const n = state.eyeNeutral;
  // EYE_UP_MORPH_REST: bù iris người tự nhiên nằm dưới tâm khe mắt một chút.
  // Không ảnh hưởng bone → không gây bất đối xứng L/R như dùng pitch bias.
  const lUp   = Math.min(Math.max((leftEyeLook.up    - (n?.leftUp    ?? 0)), 0) + EYE_UP_MORPH_REST, 1);
  const lDown = Math.max((leftEyeLook.down  - (n?.leftDown  ?? 0)), 0);
  const rUp   = Math.min(Math.max((rightEyeLook.up   - (n?.rightUp   ?? 0)), 0) + EYE_UP_MORPH_REST, 1);
  const rDown = Math.max((rightEyeLook.down - (n?.rightDown ?? 0)), 0);

  updateMorphTargetSmooth("eyeLookUp_L",   lUp,                  EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookDown_L", lDown,                EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookIn_L",   leftEyeLook.inward,   EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookOut_L",  leftEyeLook.outward,  EYE_LOOK_MORPH_LERP);

  updateMorphTargetSmooth("eyeLookUp_R",   rUp,                  EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookDown_R", rDown,                EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookIn_R",   rightEyeLook.inward,  EYE_LOOK_MORPH_LERP);
  updateMorphTargetSmooth("eyeLookOut_R",  rightEyeLook.outward, EYE_LOOK_MORPH_LERP);

  // Target bone = eye + head bias, clamp cùng giới hạn với mesh (tránh debug hiện ~1.2 rad trong khi mắt chỉ ±0.72)
  // tLY: target yaw left
  // tLP: target pitch left
  // tRY: target yaw right
  // tRP: target pitch right
  const tLY = THREE.MathUtils.clamp(
    leftRotationYaw + headGazeBias.rotationYaw,
    -EYE_YAW_LIMIT,
    EYE_YAW_LIMIT,
  );
  const tLP = THREE.MathUtils.clamp(
    leftRotationPitch  + headGazeBias.rotationPitch + EYE_PITCH_CORRECTION,
    -EYE_PITCH_LIMIT,
    EYE_PITCH_LIMIT,
  );
  const tRY = THREE.MathUtils.clamp(
    rightRotationYaw + headGazeBias.rotationYaw,
    -EYE_YAW_LIMIT,
    EYE_YAW_LIMIT,
  );
  const tRP = THREE.MathUtils.clamp(
    rightRotationPitch + headGazeBias.rotationPitch + EYE_PITCH_CORRECTION,
    -EYE_PITCH_LIMIT,
    EYE_PITCH_LIMIT,
  );

  const EYE_LERP = 0.72;
  state.eyeSmooth.leftPitch = THREE.MathUtils.lerp(state.eyeSmooth.leftPitch, tLP, EYE_LERP);
  state.eyeSmooth.leftYaw = THREE.MathUtils.lerp(state.eyeSmooth.leftYaw, tLY, EYE_LERP);
  state.eyeSmooth.rightPitch = THREE.MathUtils.lerp(state.eyeSmooth.rightPitch, tRP, EYE_LERP);
  state.eyeSmooth.rightYaw = THREE.MathUtils.lerp(state.eyeSmooth.rightYaw, tRY, EYE_LERP);

  // Áp xoay bone 3D cho mắt
  setEyeRotation(
    state.eyeSmooth.leftPitch,
    state.eyeSmooth.leftYaw,
    state.eyeSmooth.rightPitch,
    state.eyeSmooth.rightYaw,
  );

  updateDebugPanel({
    lYaw:   tLY,    lPitch:   tLP,
    rYaw:   tRY,   rPitch:   tRP,
    smoothLY: state.eyeSmooth.leftYaw,  smoothLP: state.eyeSmooth.leftPitch,
    smoothRY: state.eyeSmooth.rightYaw, smoothRP: state.eyeSmooth.rightPitch,
    lUp:  leftEyeLook.up,     lDown: leftEyeLook.down,
    lIn:  leftEyeLook.inward,  lOut:  leftEyeLook.outward,
    rUp:  rightEyeLook.up,    rDown: rightEyeLook.down,
    rIn:  rightEyeLook.inward, rOut:  rightEyeLook.outward,
  });
}

// ─── Private: Eye Neutral Calibration ────────────────────────────────────────

/**
 * Tích lũy mẫu eye look và tính neutral sau 12 frame.
 * Neutral = giá trị rotation khi người dùng nhìn thẳng vào camera lúc mới bật.
 * Mỗi frame sau đó trừ bỏ neutral để mắt không bị lệch về một phía.
 */
/**
 * Tích lũy mẫu eye look và tính neutral sau 15 frame.
 * Bù cả bone rotation (pitch/yaw) lẫn morph up/down — tránh mắt nhân vật
 * bị lệch lên/xuống hệ thống do bias anatomy hoặc góc camera.
 */
function updateEyeNeutral(leftEyeLook, rightEyeLook) {
  if (state.eyeNeutral) return;

  state.eyeNeutralSamples.push({
    leftPitch:  leftEyeLook.rotationPitch,
    leftYaw:    leftEyeLook.rotationYaw,
    rightPitch: rightEyeLook.rotationPitch,
    rightYaw:   rightEyeLook.rotationYaw,
    leftUp:     leftEyeLook.up,
    leftDown:   leftEyeLook.down,
    rightUp:    rightEyeLook.up,
    rightDown:  rightEyeLook.down,
  });

  if (state.eyeNeutralSamples.length < 15) return;

  state.eyeNeutral = averageEyeNeutralSamples(state.eyeNeutralSamples);
  state.eyeNeutralSamples = [];
}

/**
 * Tính trung bình của các mẫu eye neutral.
 * @param {Array} samples
 */
function averageEyeNeutralSamples(samples) {
  const n = samples.length;
  const total = samples.reduce(
    (acc, s) => ({
      leftPitch:  acc.leftPitch  + s.leftPitch,
      leftYaw:    acc.leftYaw    + s.leftYaw,
      rightPitch: acc.rightPitch + s.rightPitch,
      rightYaw:   acc.rightYaw   + s.rightYaw,
      leftUp:     acc.leftUp     + s.leftUp,
      leftDown:   acc.leftDown   + s.leftDown,
      rightUp:    acc.rightUp    + s.rightUp,
      rightDown:  acc.rightDown  + s.rightDown,
    }),
    { leftPitch: 0, leftYaw: 0, rightPitch: 0, rightYaw: 0,
      leftUp: 0, leftDown: 0, rightUp: 0, rightDown: 0 },
  );

  return {
    leftPitch:  total.leftPitch  / n,
    leftYaw:    total.leftYaw    / n,
    rightPitch: total.rightPitch / n,
    rightYaw:   total.rightYaw   / n,
    leftUp:     total.leftUp     / n,
    leftDown:   total.leftDown   / n,
    rightUp:    total.rightUp    / n,
    rightDown:  total.rightDown  / n,
  };
}

function clearTrackedPose() {
  state.headEuler = { pitch: 0, yaw: 0, roll: 0 };
  state.smoothedValues = {};
  state.eyeNeutral = null;
  state.eyeFilters = null;
  state.eyeNeutralSamples = [];
  clearLipSyncCameraSignal();
  setHeadRotation(0, 0, 0);
  setEyeRotation(0, 0, 0, 0);
}

/** Dừng và giải phóng camera stream, ẩn video preview */
function stopCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }

  if (state.cameraPreview) {
    state.cameraPreview.pause();
    state.cameraPreview.srcObject = null;
  }

  clearOverlay(state.overlayContext, state.cameraOverlay);
}

function setTrackingButtonState(active) {
  if (!state.trackingButton) return;
  state.trackingButton.textContent = active ? "Stop Camera" : "Live Camera";
  state.trackingButton.classList.toggle("active", active);
}

function setTrackingStatus(text) {
  if (state.trackingStatus) state.trackingStatus.textContent = text;
}


function createDebugPanel() {
  if (state.debugEl) return;
  const el = document.createElement("div");
  el.id = "eye-debug-panel";
  el.style.cssText = [
    "position:fixed","top:8px","left:8px","z-index:9999",
    "background:rgba(0,0,0,0.85)","color:#e0e0e0",
    "font:12px/1.6 'Courier New',monospace",
    "padding:10px 14px","border-radius:8px",
    "border:1px solid #444","min-width:420px",
    "pointer-events:none","display:none",
  ].join(";");
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;pointer-events:auto">
      <div style="color:#aef;font-weight:bold">
        👁 EYE DEBUG
        <span id="edbg-calib" style="font-size:10px;margin-left:8px;color:#fa0"></span>
      </div>
      <button type="button" id="edbg-copy" title="Copy số liệu debug (clipboard)"
        style="font:11px/1.2 'Courier New',monospace;cursor:pointer;padding:4px 10px;border-radius:4px;
        border:1px solid #555;background:#2a2a2a;color:#cecece;flex-shrink:0">
        Copy
      </button>
    </div>
    <table style="border-collapse:collapse;width:100%">
      <tr style="color:#555;font-size:10px">
        <td style="padding-right:6px"></td>
        <td colspan="2" style="text-align:center;padding-right:6px;border-right:1px solid #333">LEFT</td>
        <td colspan="2" style="text-align:center">RIGHT</td>
      </tr>
      <tr style="color:#444;font-size:9px">
        <td></td>
        <td style="text-align:right;padding-right:4px">Trg</td>
        <td style="text-align:right;padding-right:6px;border-right:1px solid #333">Char</td>
        <td style="text-align:right;padding-right:4px">Trg</td>
        <td style="text-align:right">Char</td>
      </tr>

      <tr><td colspan="5" style="color:#446;font-size:10px;padding-top:3px">── Iris rotation (target = eye+head bias) ─</td></tr>
      <tr>
        <td style="color:#7cf;padding-right:6px">Yaw</td>
        <td id="edbg-ly" style="text-align:right;padding-right:4px"></td>
        <td id="edbg-sly" style="text-align:right;color:#8f8;padding-right:6px;border-right:1px solid #333"></td>
        <td id="edbg-ry" style="text-align:right;padding-right:4px"></td>
        <td id="edbg-sry" style="text-align:right;color:#8f8"></td>
      </tr>
      <tr>
        <td style="color:#7cf;padding-right:6px">Pitch</td>
        <td id="edbg-lp" style="text-align:right;padding-right:4px"></td>
        <td id="edbg-slp" style="text-align:right;color:#8f8;padding-right:6px;border-right:1px solid #333"></td>
        <td id="edbg-rp" style="text-align:right;padding-right:4px"></td>
        <td id="edbg-srp" style="text-align:right;color:#8f8"></td>
      </tr>

    </table>

    <!-- Spatial eye diagram: outer/inner horizontal, upper/lower vertical -->
    <div style="color:#446;font-size:10px;padding-top:5px;margin-bottom:4px">
      ── Eye look morphs ── <span style="color:#e0e0e0">You</span><span style="color:#555"> / </span><span style="color:#8f8">Char</span>
    </div>
    <div style="display:flex;gap:0;font-size:10px;font-family:'Courier New',monospace">

      <!-- LEFT EYE: outer=left(temple), inner=right(nose) -->
      <div style="flex:1;min-width:0">
        <div style="color:#555;font-size:9px;text-align:center;margin-bottom:3px">LEFT</div>
        <div style="display:grid;grid-template-columns:1fr 16px 1fr;grid-template-rows:auto auto auto;gap:2px 4px;align-items:center">
          <div></div>
          <div style="text-align:center">
            <div style="color:#446;font-size:9px">▲ up</div>
            <div id="edbg-lup-u" style="text-align:center"></div>
            <div id="edbg-lup-c" style="text-align:center;color:#8f8"></div>
          </div>
          <div></div>

          <div style="text-align:right">
            <div style="color:#446;font-size:9px">out ◀</div>
            <div id="edbg-lot-u"></div>
            <div id="edbg-lot-c" style="color:#8f8"></div>
          </div>
          <div style="text-align:center;color:#7cf;font-size:16px;line-height:1.2">●</div>
          <div style="text-align:left">
            <div style="color:#446;font-size:9px">▶ in</div>
            <div id="edbg-lin-u"></div>
            <div id="edbg-lin-c" style="color:#8f8"></div>
          </div>

          <div></div>
          <div style="text-align:center">
            <div id="edbg-ldn-u" style="text-align:center"></div>
            <div id="edbg-ldn-c" style="text-align:center;color:#8f8"></div>
            <div style="color:#446;font-size:9px">▼ dn</div>
          </div>
          <div></div>
        </div>
      </div>

      <div style="width:1px;background:#333;margin:0 8px;align-self:stretch"></div>

      <!-- RIGHT EYE: inner=left(nose), outer=right(temple) -->
      <div style="flex:1;min-width:0">
        <div style="color:#555;font-size:9px;text-align:center;margin-bottom:3px">RIGHT</div>
        <div style="display:grid;grid-template-columns:1fr 16px 1fr;grid-template-rows:auto auto auto;gap:2px 4px;align-items:center">
          <div></div>
          <div style="text-align:center">
            <div style="color:#446;font-size:9px">▲ up</div>
            <div id="edbg-rup-u" style="text-align:center"></div>
            <div id="edbg-rup-c" style="text-align:center;color:#8f8"></div>
          </div>
          <div></div>

          <div style="text-align:right">
            <div style="color:#446;font-size:9px">in ◀</div>
            <div id="edbg-rin-u"></div>
            <div id="edbg-rin-c" style="color:#8f8"></div>
          </div>
          <div style="text-align:center;color:#7cf;font-size:16px;line-height:1.2">●</div>
          <div style="text-align:left">
            <div style="color:#446;font-size:9px">▶ out</div>
            <div id="edbg-rot-u"></div>
            <div id="edbg-rot-c" style="color:#8f8"></div>
          </div>

          <div></div>
          <div style="text-align:center">
            <div id="edbg-rdn-u" style="text-align:center"></div>
            <div id="edbg-rdn-c" style="text-align:center;color:#8f8"></div>
            <div style="color:#446;font-size:9px">▼ dn</div>
          </div>
          <div></div>
        </div>
      </div>
    </div>
    <div style="margin-top:4px" id="edbg-bar-y"></div>
    <div id="edbg-bar-p"></div>
    <div style="margin-top:4px;color:#555;font-size:10px">
      Head P:<span id="edbg-hp"></span> Y:<span id="edbg-hy"></span>
      &nbsp;|&nbsp;Neutral:<span id="edbg-nval" style="color:#888">-</span>
    </div>
    <div style="margin-top:2px;color:#333;font-size:9px">
      Press <kbd style="background:#222;padding:0 3px;border-radius:2px">D</kbd> to toggle
    </div>`;
  document.body.appendChild(el);
  state.debugEl = el;
  el.querySelector("#edbg-copy")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void copyEyeDebugSnapshotToClipboard();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "d" || e.key === "D") &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA") {
      toggleEyeDebugPanel();
    }
  });
}

function fmtVal(v, limit) {
  if (v == null || !isFinite(v)) return `<span style="color:#555">---</span>`;
  const pct = Math.min(Math.abs(v) / limit, 1);
  const color = pct > 0.75 ? "#4f4" : pct > 0.35 ? "#ff4" : "#aaa";
  // Morph weights (limit = 1) are always 0–1, skip the +/- prefix for clarity
  const prefix = limit === 1 ? "" : (v >= 0 ? "+" : "");
  return `<span style="color:${color}">${prefix}${v.toFixed(3)}</span>`;
}

function renderBar(value, limit, label) {
  const W = 170, mid = W / 2;
  const pos = Math.round(((value / limit) * 0.5 + 0.5) * W);
  const color = Math.abs(value / limit) > 0.75 ? "#4f4" : Math.abs(value / limit) > 0.35 ? "#ff4" : "#558";
  return `<span style="color:#555;font-size:10px">${label}</span>`
    + `<span style="display:inline-block;width:${W}px;height:7px;background:#1a1a1a;border-radius:3px;`
    + `position:relative;vertical-align:middle;margin-left:4px">`
    + `<span style="position:absolute;left:${mid-1}px;top:1px;width:1px;height:5px;background:#444"></span>`
    + `<span style="position:absolute;left:${Math.max(0,Math.min(pos-2,W-4))}px;top:1px;`
    + `width:4px;height:5px;background:${color};border-radius:2px"></span></span>`;
}

function updateDebugPanel(v) {
  if (!state.debugEl || !state.debugVisible) return;
  const set = (id, html) => { const e = state.debugEl.querySelector(`#${id}`); if (e) e.innerHTML = html; };

  set("edbg-calib", state.eyeNeutral
    ? `✓ Calibrated`
    : `⏳ ${state.eyeNeutralSamples.length}/15`);

  if (!v) return;
  // Iris rotation — Trg (bone target this frame) vs Char (EYE_LERP smoothed)
  set("edbg-ly",  fmtVal(v.lYaw,     EYE_YAW_LIMIT));
  set("edbg-sly", fmtVal(v.smoothLY, EYE_YAW_LIMIT));
  set("edbg-ry",  fmtVal(v.rYaw,     EYE_YAW_LIMIT));
  set("edbg-sry", fmtVal(v.smoothRY, EYE_YAW_LIMIT));
  set("edbg-lp",  fmtVal(v.lPitch,   EYE_PITCH_LIMIT));
  set("edbg-slp", fmtVal(v.smoothLP, EYE_PITCH_LIMIT));
  set("edbg-rp",  fmtVal(v.rPitch,   EYE_PITCH_LIMIT));
  set("edbg-srp", fmtVal(v.smoothRP, EYE_PITCH_LIMIT));

  // Eye look morphs — You (camera) vs Char (applied to model)
  const sv = state.smoothedValues;
  set("edbg-lup-u", fmtVal(v.lUp   ?? 0, 1)); set("edbg-lup-c", fmtVal(sv.eyeLookUp_L   ?? 0, 1));
  set("edbg-rup-u", fmtVal(v.rUp   ?? 0, 1)); set("edbg-rup-c", fmtVal(sv.eyeLookUp_R   ?? 0, 1));
  set("edbg-ldn-u", fmtVal(v.lDown ?? 0, 1)); set("edbg-ldn-c", fmtVal(sv.eyeLookDown_L ?? 0, 1));
  set("edbg-rdn-u", fmtVal(v.rDown ?? 0, 1)); set("edbg-rdn-c", fmtVal(sv.eyeLookDown_R ?? 0, 1));
  set("edbg-lin-u", fmtVal(v.lIn   ?? 0, 1)); set("edbg-lin-c", fmtVal(sv.eyeLookIn_L   ?? 0, 1));
  set("edbg-rin-u", fmtVal(v.rIn   ?? 0, 1)); set("edbg-rin-c", fmtVal(sv.eyeLookIn_R   ?? 0, 1));
  set("edbg-lot-u", fmtVal(v.lOut  ?? 0, 1)); set("edbg-lot-c", fmtVal(sv.eyeLookOut_L  ?? 0, 1));
  set("edbg-rot-u", fmtVal(v.rOut  ?? 0, 1)); set("edbg-rot-c", fmtVal(sv.eyeLookOut_R  ?? 0, 1));

  set("edbg-bar-y", renderBar(v.smoothLY ?? 0, EYE_YAW_LIMIT,   "Y"));
  set("edbg-bar-p", renderBar(v.smoothLP ?? 0, EYE_PITCH_LIMIT, "P"));
  set("edbg-hp",  fmtVal(state.headEuler.pitch, 0.5));
  set("edbg-hy",  fmtVal(state.headEuler.yaw,   0.8));
  set("edbg-nval", state.eyeNeutral
    ? `Y${state.eyeNeutral.leftYaw.toFixed(2)} P${state.eyeNeutral.leftPitch.toFixed(2)}`
    : `-`);

  state.lastEyeDebugSnapshot = {
    capturedAt: new Date().toISOString(),
    calibrated: Boolean(state.eyeNeutral),
    iris: {
      left: {
        yawTrg: v.lYaw,
        yawChar: v.smoothLY,
        pitchTrg: v.lPitch,
        pitchChar: v.smoothLP,
      },
      right: {
        yawTrg: v.rYaw,
        yawChar: v.smoothRY,
        pitchTrg: v.rPitch,
        pitchChar: v.smoothRP,
      },
    },
    morphsYou: {
      left: { up: v.lUp ?? 0, down: v.lDown ?? 0, in: v.lIn ?? 0, out: v.lOut ?? 0 },
      right: { up: v.rUp ?? 0, down: v.rDown ?? 0, in: v.rIn ?? 0, out: v.rOut ?? 0 },
    },
    morphsChar: {
      left: {
        up: sv.eyeLookUp_L ?? 0,
        down: sv.eyeLookDown_L ?? 0,
        in: sv.eyeLookIn_L ?? 0,
        out: sv.eyeLookOut_L ?? 0,
      },
      right: {
        up: sv.eyeLookUp_R ?? 0,
        down: sv.eyeLookDown_R ?? 0,
        in: sv.eyeLookIn_R ?? 0,
        out: sv.eyeLookOut_R ?? 0,
      },
    },
    head: { pitch: state.headEuler.pitch, yaw: state.headEuler.yaw },
    neutral: state.eyeNeutral
      ? {
          leftYaw: state.eyeNeutral.leftYaw,
          leftPitch: state.eyeNeutral.leftPitch,
          rightYaw: state.eyeNeutral.rightYaw,
          rightPitch: state.eyeNeutral.rightPitch,
        }
      : null,
  };
}

function formatEyeDebugSnapshotText(s) {
  if (!s) {
    return "EYE DEBUG — chưa có snapshot (bật camera và có mặt trong khung hình).";
  }
  const n = (x) => (typeof x === "number" && isFinite(x) ? x.toFixed(4) : String(x));
  const lines = [
    `EYE DEBUG @ ${s.capturedAt}`,
    `Calibrated: ${s.calibrated}`,
    "",
    "Iris rotation (rad) — Trg / Char",
    `  Left:  yaw ${n(s.iris.left.yawTrg)} / ${n(s.iris.left.yawChar)}   pitch ${n(s.iris.left.pitchTrg)} / ${n(s.iris.left.pitchChar)}`,
    `  Right: yaw ${n(s.iris.right.yawTrg)} / ${n(s.iris.right.yawChar)}   pitch ${n(s.iris.right.pitchTrg)} / ${n(s.iris.right.pitchChar)}`,
    "",
    "Eye look morphs [0,1] — You / Char",
    `  Left:  up ${n(s.morphsYou.left.up)} / ${n(s.morphsChar.left.up)}   dn ${n(s.morphsYou.left.down)} / ${n(s.morphsChar.left.down)}   in ${n(s.morphsYou.left.in)} / ${n(s.morphsChar.left.in)}   out ${n(s.morphsYou.left.out)} / ${n(s.morphsChar.left.out)}`,
    `  Right: up ${n(s.morphsYou.right.up)} / ${n(s.morphsChar.right.up)}   dn ${n(s.morphsYou.right.down)} / ${n(s.morphsChar.right.down)}   in ${n(s.morphsYou.right.in)} / ${n(s.morphsChar.right.in)}   out ${n(s.morphsYou.right.out)} / ${n(s.morphsChar.right.out)}`,
    "",
    `Head (rad): pitch ${n(s.head.pitch)}   yaw ${n(s.head.yaw)}`,
    s.neutral
      ? `Neutral (rad): L yaw ${n(s.neutral.leftYaw)} pitch ${n(s.neutral.leftPitch)} | R yaw ${n(s.neutral.rightYaw)} pitch ${n(s.neutral.rightPitch)}`
      : "Neutral: (chưa calibrate)",
  ];
  return lines.join("\n");
}

async function copyEyeDebugSnapshotToClipboard() {
  const text = formatEyeDebugSnapshotText(state.lastEyeDebugSnapshot);
  const btn = state.debugEl?.querySelector("#edbg-copy");
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Đã copy";
      btn.style.color = "#8f8";
      setTimeout(() => {
        btn.textContent = prev;
        btn.style.color = "#cecece";
      }, 1200);
    }
  } catch (err) {
    console.warn("Clipboard:", err);
    if (btn) {
      btn.textContent = "Lỗi";
      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    }
  }
}
