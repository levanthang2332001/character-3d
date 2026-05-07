/**
 * face_tracking_utils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tập hợp các hàm tính toán thuần túy (pure functions) cho face tracking.
 * Không có side effects, không gọi DOM, không thay đổi state ngoài.
 *
 * Trách nhiệm:
 *  1. BLENDSHAPE_MAP   - Map tên MediaPipe → tên morph target của model
 *  2. Head pose        - Tính pitch/yaw/roll đầu từ landmarks
 *  3. Eye look         - Tính hướng nhìn từ vị trí iris
 *  4. Head gaze bias   - Offset nhỏ cho mắt dựa theo góc đầu (tự nhiên hơn)
 *  5. Mouth signal     - Trích xuất giá trị miệng cho lip sync
 *  6. Overlay drawing  - Vẽ khung mặt lên canvas camera preview
 *
 * Hệ tọa độ của MediaPipe landmarks:
 *  - (0,0) = góc trên-trái của video
 *  - x tăng sang PHẢI, y tăng XUỐNG
 *  - Giá trị đã normalize [0, 1]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from "three";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { LIP_SYNC_MORPH_TARGETS } from "./constants.js";

// ─── Exported Constants ───────────────────────────────────────────────────────

/**
 * Danh sách tên morph target liên quan đến hướng nhìn của mắt.
 * Dùng để reset về 0 khi mất tracking mắt.
 */
export const EYE_LOOK_TARGETS = [
  "eyeLookUp_L",
  "eyeLookUp_R",
  "eyeLookDown_L",
  "eyeLookDown_R",
  "eyeLookIn_L",
  "eyeLookIn_R",
  "eyeLookOut_L",
  "eyeLookOut_R",
];

/**
 * Set nhanh để check xem morph có phải eye look không (O(1) lookup).
 * Dùng trong face_mesh.js để skip khỏi face blendshapes loop.
 */
export const EYE_LOOK_TARGET_SET = new Set(EYE_LOOK_TARGETS);

/**
 * Hệ số giảm nhẹ cho các morph lông mày khi tracking camera.
 *
 * Vấn đề: khi người dùng "trợn mắt" (nhìn lên), cơ chân mày tự nhiên co nhẹ.
 * MediaPipe detect điều này và activate browInnerUp / browOuterUp với score cao
 * → chân mày kéo lên rõ ràng trong khi mắt mới là điểm chính cần di chuyển.
 *
 * Giải pháp: nhân score với BROW_MORPH_SCALE để giảm biên độ lông mày.
 * Giữ nguyên 1.0 cho các morph khác.
 *
 * TUNING:
 *  - Tăng → chân mày di chuyển nhiều hơn theo facial expression
 *  - Giảm → chân mày ít phản hồi hơn, tránh kéo khi trợn mắt
 */
export const BROW_MORPH_SCALE = {
  browInnerUp: 0.25,   // lông mày giữa: giảm nhiều nhất (hay bị trigger khi nhìn lên)
  browOuterUp_L: 0.30,   // lông mày ngoài trái
  browOuterUp_R: 0.30,   // lông mày ngoài phải
  browDown_L: 0.50,   // lông mày xuống trái (ít bị ảnh hưởng hơn, giữ 50%)
  browDown_R: 0.50,   // lông mày xuống phải
};

/**
 * BLENDSHAPE_MAP: MediaPipe categoryName → tên morph target trong model.
 *
 * Lưu ý về TRÁI/PHẢI:
 *  MediaPipe dùng góc nhìn của camera (mirror), model dùng góc nhìn của nhân vật.
 *  → "Left" trong MediaPipe = "_R" trong model và ngược lại.
 *  Ví dụ: browDownLeft (lông mày trái của CAMERA) = browDown_R (phải của MODEL).
 */
export const BLENDSHAPE_MAP = {
  // Lông mày
  browDownLeft: "browDown_R",
  browDownRight: "browDown_L",
  browInnerUp: "browInnerUp",
  browOuterUpLeft: "browOuterUp_R",
  browOuterUpRight: "browOuterUp_L",

  // Má
  cheekPuff: "cheekPuff",

  // Hướng nhìn (eye look) - dùng để tính morph blendshape nhìn 4 hướng
  eyeLookDownLeft: "eyeLookDown_L",
  eyeLookDownRight: "eyeLookDown_R",
  eyeLookInLeft: "eyeLookIn_L",
  eyeLookInRight: "eyeLookIn_R",
  eyeLookOutLeft: "eyeLookOut_L",
  eyeLookOutRight: "eyeLookOut_R",
  eyeLookUpLeft: "eyeLookUp_L",
  eyeLookUpRight: "eyeLookUp_R",

  // Mắt (mở/nhắm)
  eyeBlinkLeft: "eyeBlink_R",
  eyeBlinkRight: "eyeBlink_L",
  eyeSquintLeft: "eyeSquint_R",
  eyeSquintRight: "eyeSquint_L",
  eyeWideLeft: "eyeWide_R",
  eyeWideRight: "eyeWide_L",

  // Hàm
  jawOpen: "jawOpen",

  // Miệng (mouth)
  mouthFrownLeft: "mouthFrown_R",
  mouthFrownRight: "mouthFrown_L",
  mouthFunnel: "mouthFunnel",
  mouthLeft: "mouthLeft",
  mouthLowerDownLeft: "mouthLowerDown_R",
  mouthLowerDownRight: "mouthLowerDown_L",
  mouthPressLeft: "mouthPress_R",
  mouthPressRight: "mouthPress_L",
  mouthPucker: "mouthPucker",
  mouthRight: "mouthRight",
  mouthRollLower: "mouthRollLower",
  mouthRollUpper: "mouthRollUpper",
  mouthShrugLower: "mouthShrugLower",
  mouthShrugUpper: "mouthShrugUpper",
  mouthSmileLeft: "mouthSmile_R",
  mouthSmileRight: "mouthSmile_L",
  mouthStretchLeft: "mouthStretch_R",
  mouthStretchRight: "mouthStretch_L",
  mouthUpperUpLeft: "mouthUpperUp_R",
  mouthUpperUpRight: "mouthUpperUp_L",

  // Mũi
  noseSneerLeft: "noseSneer_R",
  noseSneerRight: "noseSneer_L",
};

/** Set morph targets thuộc về lip sync (để face_mesh.js biết mà không ghi đè khi lip sync đang chạy) */
export const LIP_SYNC_MORPH_TARGET_SET = new Set(LIP_SYNC_MORPH_TARGETS);

// ─── Landmark Indices ─────────────────────────────────────────────────────────

/**
 * Chỉ số landmark MediaPipe của từng điểm mắt.
 * MediaPipe face mesh có 478 landmarks; các chỉ số này là vị trí cố định.
 *  - iris: 5 điểm (center + 4 điểm viền) dùng để tính tâm iris
 *  - inner/outer/upper/lower: viền mắt
 */
const EYE_LANDMARKS = {
  left: {
    inner: 362,   // góc trong (gần sống mũi)
    outer: 263,   // góc ngoài (phía thái dương)
    upper: 386,   // điểm trên mí
    lower: 374,   // điểm dưới mí
    iris: [473, 474, 475, 476, 477],  // tâm và viền iris
  },
  right: {
    inner: 33,
    outer: 133,
    upper: 159,
    lower: 145,
    iris: [468, 469, 470, 471, 472],
  },
};

// ─── Head Pose Estimation ─────────────────────────────────────────────────────

/**
 * Tính góc Euler của đầu từ các landmark khuôn mặt.
 *
 * Phương pháp (heuristic, không dùng 3D projection):
 *  - Yaw   (quay ngang): offset ngang của mũi so với tâm hai mắt
 *  - Pitch (gật đầu)  : offset dọc của mũi so với tâm hai mắt
 *  - Roll  (nghiêng)  : góc nghiêng của đường nối hai mắt
 *  - positionYaw: hiệu chỉnh thêm theo vị trí khuôn mặt trong khung hình
 *    (nếu mặt lệch trái trong camera → head thực tế đang quay phải)
 *
 * Kết quả được lerp với giá trị cũ để làm mượt (tránh giật).
 *
 * @param {Array}  landmarks   - Mảng 478 điểm {x, y, z}
 * @param {{pitch, yaw, roll}} currentEuler - Góc hiện tại để lerp
 * @returns {{pitch, yaw, roll}}
 */
export function createHeadPoseFromLandmarks(landmarks, currentEuler) {
  // Lấy các điểm mốc cơ bản
  const leftEyeInner = landmarks[362];
  const leftEyeOuter = landmarks[263];
  const rightEyeInner = landmarks[33];
  const rightEyeOuter = landmarks[133];

  const leftEye = midpoint(leftEyeInner, leftEyeOuter);
  const rightEye = midpoint(rightEyeInner, rightEyeOuter);
  const nose = landmarks[1]; // đầu mũi
  const eyeCenter = midpoint(leftEye, rightEye);

  // Khoảng cách giữa hai mắt: dùng làm "đơn vị đo" chuẩn hóa
  // Tránh chia cho 0 nên đặt min = 0.001
  const eyeDistance = Math.max(distance2D(leftEye, rightEye), 0.001);

  // YAW: mũi lệch ngang bao nhiêu so với tâm mắt → đầu đang quay bên nào
  //      chia cho (eyeDistance * 0.8) để normalize về [-1, 1]
  const rawYaw = THREE.MathUtils.clamp((nose.x - eyeCenter.x) / (eyeDistance * 0.8), -1, 1);

  // PITCH: mũi lệch dọc so với tâm mắt (âm vì y tăng xuống dưới)
  const pitchDiff = -(nose.y - eyeCenter.y);
  const rawPitch = THREE.MathUtils.clamp(pitchDiff / (eyeDistance * 2.5), -1, 1);

  // ROLL: góc nghiêng của đường nối hai mắt (atan2 tính góc trong mặt phẳng 2D)
  //       nhân 0.5 để giảm biên độ lắc lư
  const rawRoll = THREE.MathUtils.clamp(
    Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 0.5,
    -0.3, 0.3,
  );

  // POSITION BIAS: nếu khuôn mặt không ở giữa frame, cần bù thêm một chút yaw
  //               vì camera nhìn góc nghiêng làm sai lệch ước tính yaw từ landmark
  const faceCenter = getLandmarkBoundsCenter(landmarks);
  const positionYaw = THREE.MathUtils.clamp((0.5 - faceCenter.x) * 1.35, -0.55, 0.55);

  // Lerp kết quả để làm mượt (0.3 = 30% tiến đến giá trị mới mỗi frame)
  return {
    yaw: THREE.MathUtils.lerp(currentEuler.yaw, -rawYaw * 0.65 + positionYaw, 0.3),
    pitch: THREE.MathUtils.lerp(currentEuler.pitch, -rawPitch * 0.5, 0.3),
    roll: THREE.MathUtils.lerp(currentEuler.roll, rawRoll, 0.25),
  };
}

// ─── One Euro Filter ──────────────────────────────────────────────────────────

/**
 * Adaptive low-pass filter (Casiez et al. 2012).
 *
 * Ý tưởng cốt lõi:
 *  - Khi mắt ĐỨNG YÊN (velocity nhỏ) → cutoff thấp → lọc mạnh → ít jitter
 *  - Khi mắt SACCADE   (velocity lớn) → cutoff cao  → lọc nhẹ → ít trễ
 *
 * Tham số tune:
 *  - minCutoff : Hz, càng nhỏ càng mượt khi đứng yên (nhưng dễ lag khi di chuyển)
 *  - beta      : hệ số nhạy với tốc độ. beta=0 → không adaptive (= low-pass thuần)
 *  - dCutoff   : Hz, smoothing của bản thân ước tính velocity
 *
 * @param {number} minCutoff
 * @param {number} beta
 * @param {number} [dCutoff=1.0]
 * @returns {(x: number, timestampMs: number) => number}
 */
function createOneEuroFilter(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
  let xPrev  = null;
  let dxPrev = 0;
  let tPrev  = null;

  return function filter(x, timestampMs) {
    // Frame đầu: khởi tạo không có gì để filter
    if (xPrev === null) { xPrev = x; tPrev = timestampMs; return x; }

    const dt = Math.max((timestampMs - tPrev) * 0.001, 0.0005); // ms → s, min 0.5ms
    tPrev = timestampMs;

    // Bước 1: ước tính velocity (dx/dt), làm mượt bằng low-pass cố định
    const rawDx      = (x - xPrev) / dt;
    const aDx        = _oefAlpha(dt, dCutoff);
    const dxFiltered = aDx * rawDx + (1 - aDx) * dxPrev;
    dxPrev = dxFiltered;

    // Bước 2: tính cutoff adaptive theo độ lớn của velocity
    const cutoff   = minCutoff + beta * Math.abs(dxFiltered);
    const a        = _oefAlpha(dt, cutoff);
    const xFiltered = a * x + (1 - a) * xPrev;
    xPrev = xFiltered;

    return xFiltered;
  };
}

/** Tính alpha (EMA weight) từ dt và cutoff frequency */
function _oefAlpha(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

// ─── Tham số One Euro Filter cho eye look ────────────────────────────────────
//
// BLEND morphs (outward/inward/up/down, range [0,1]):
//   minCutoff thấp → mượt khi đứng yên, beta vừa → follow morph movement
// ROTATION (pitch/yaw, radian):
//   minCutoff cao hơn + beta cao hơn → phản hồi nhanh saccade
//
// TUNING:
//   jitter nhiều khi yên → giảm minCutoff hoặc beta
//   trễ nhiều khi nhìn nhanh → tăng beta
const BLEND_MIN_CUTOFF = 0.8;
const BLEND_BETA       = 0.4;
const ROT_MIN_CUTOFF   = 1.5;
const ROT_BETA         = 0.9;
const D_CUTOFF         = 1.0;

/**
 * Tạo bộ filter One Euro cho cả hai mắt.
 * Mỗi field (outward/inward/up/down/pitch/yaw) có filter riêng biệt.
 * Gọi một lần khi bắt đầu tracking, truyền vào createEyeLookFromLandmarks mỗi frame.
 *
 * @returns {{ left: EyeFilterSet, right: EyeFilterSet }}
 */
export function createEyeLookFilters() {
  const makeSet = () => ({
    outward:       createOneEuroFilter(BLEND_MIN_CUTOFF, BLEND_BETA, D_CUTOFF),
    inward:        createOneEuroFilter(BLEND_MIN_CUTOFF, BLEND_BETA, D_CUTOFF),
    up:            createOneEuroFilter(BLEND_MIN_CUTOFF, BLEND_BETA, D_CUTOFF),
    down:          createOneEuroFilter(BLEND_MIN_CUTOFF, BLEND_BETA, D_CUTOFF),
    rotationPitch: createOneEuroFilter(ROT_MIN_CUTOFF,   ROT_BETA,   D_CUTOFF),
    rotationYaw:   createOneEuroFilter(ROT_MIN_CUTOFF,   ROT_BETA,   D_CUTOFF),
  });
  return { left: makeSet(), right: makeSet() };
}

// ─── Eye Look Estimation ──────────────────────────────────────────────────────

/**
 * Tính hướng nhìn của cả hai mắt từ vị trí iris, áp One Euro Filter.
 *
 * @param {Array}  landmarks   - 478 điểm landmark
 * @param {{ left: EyeFilterSet, right: EyeFilterSet }} eyeFilters
 *   Bộ filter tạo bởi createEyeLookFilters() — giữ state giữa các frame.
 * @param {number} timestampMs - performance.now() của frame hiện tại
 * @returns {{ left: EyeLookWeights|null, right: EyeLookWeights|null }}
 */
export function createEyeLookFromLandmarks(landmarks, eyeFilters, timestampMs) {
  const rawLeft  = getEyeLookWeights(landmarks, EYE_LANDMARKS.left,  "left");
  const rawRight = getEyeLookWeights(landmarks, EYE_LANDMARKS.right, "right");

  return {
    left:  rawLeft  ? _applyEyeFilters(rawLeft,  eyeFilters.left,  timestampMs) : null,
    right: rawRight ? _applyEyeFilters(rawRight, eyeFilters.right, timestampMs) : null,
  };
}

/** Áp bộ filter lên một EyeLookWeights raw → filtered */
function _applyEyeFilters(raw, filters, ts) {
  return {
    outward:       filters.outward(raw.outward, ts),
    inward:        filters.inward(raw.inward, ts),
    up:            filters.up(raw.up, ts),
    down:          filters.down(raw.down, ts),
    rotationPitch: filters.rotationPitch(raw.rotationPitch, ts),
    rotationYaw:   filters.rotationYaw(raw.rotationYaw, ts),
  };
}

/**
 * Tính "bias" xoay mắt dựa theo hướng đầu.
 * Khi đầu quay sang phải, mắt cũng tự nhiên nhìn sang phải một chút.
 * Hệ số nhỏ (0.45, 0.55) để không làm quá lộ.
 *
 * @param {{pitch, yaw, roll}} headEuler
 * @returns {{ rotationPitch: number, rotationYaw: number }}
 */
export function createHeadGazeBias(headEuler) {
  return {
    rotationPitch: 0,
    rotationYaw:   THREE.MathUtils.clamp(headEuler.yaw * 0.30, -0.20, 0.20),
  };
}

// ─── Mouth Signal Extraction ──────────────────────────────────────────────────

/**
 * Trích xuất tín hiệu các cơ miệng từ blendshapes của MediaPipe.
 * Dùng để đưa vào lip sync controller khi đang tracking camera.
 * Đảo L/R vì MediaPipe dùng hệ tọa độ mirror.
 *
 * @param {Array} categories - Mảng { categoryName, score } từ MediaPipe
 * @returns {{ values: Object }} map morph name → score
 */
export function extractCameraMouthSignal(categories) {
  const categoryScores = Object.fromEntries(
    categories.map((category) => [category.categoryName, category.score])
  );

  return {
    values: {
      jawOpen: categoryScores.jawOpen ?? 0,
      mouthFunnel: categoryScores.mouthFunnel ?? 0,
      mouthPucker: categoryScores.mouthPucker ?? 0,
      // Đảo Left/Right cho đúng hệ tọa độ model
      mouthSmile_L: categoryScores.mouthSmileRight ?? 0,
      mouthSmile_R: categoryScores.mouthSmileLeft ?? 0,
      mouthStretch_L: categoryScores.mouthStretchRight ?? 0,
      mouthStretch_R: categoryScores.mouthStretchLeft ?? 0,
      mouthPress_L: categoryScores.mouthPressRight ?? 0,
      mouthPress_R: categoryScores.mouthPressLeft ?? 0,
      mouthUpperUp_L: categoryScores.mouthUpperUpRight ?? 0,
      mouthUpperUp_R: categoryScores.mouthUpperUpLeft ?? 0,
      mouthLowerDown_L: categoryScores.mouthLowerDownRight ?? 0,
      mouthLowerDown_R: categoryScores.mouthLowerDownLeft ?? 0,
      mouthRollLower: categoryScores.mouthRollLower ?? 0,
      mouthRollUpper: categoryScores.mouthRollUpper ?? 0,
    },
  };
}

// ─── Camera Overlay Drawing ───────────────────────────────────────────────────

/**
 * Đồng bộ kích thước canvas overlay với kích thước video thực.
 * Cần gọi mỗi khi video thay đổi kích thước.
 */
export function syncOverlaySize(cameraOverlay, cameraPreview) {
  if (!cameraOverlay || !cameraPreview) return;
  cameraOverlay.width = cameraPreview.videoWidth || 640;
  cameraOverlay.height = cameraPreview.videoHeight || 480;
}

/** Xóa toàn bộ canvas overlay (khi mất tracking) */
export function clearOverlay(overlayContext, cameraOverlay) {
  if (!overlayContext || !cameraOverlay) return;
  overlayContext.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
}

/**
 * Vẽ lưới mặt nạ (face mesh) lên canvas overlay thay vì hình chữ nhật.
 *
 * Các lớp được vẽ theo thứ tự từ mờ đến rõ:
 *  1. TESSELATION   - lưới tam giác toàn bộ mặt (mờ, tạo hiệu ứng mask)
 *  2. FACE_OVAL     - viền ngoài khuôn mặt (rõ hơn)
 *  3. Eyebrows      - lông mày (cyan sáng)
 *  4. Eyes          - viền mắt (cyan sáng)
 *  5. Irises        - tròng mắt (trắng)
 *  6. Lips          - môi (hồng nhạt)
 *
 * Lưu ý tọa độ X bị MIRROR vì camera selfie: vẽ tại (1 - x) * width.
 *
 * @param {CanvasRenderingContext2D} overlayContext
 * @param {HTMLCanvasElement}       cameraOverlay
 * @param {HTMLVideoElement}        cameraPreview
 * @param {Array}                   landmarks - 478 điểm {x, y, z} normalize [0,1]
 */
export function drawFaceFrameOverlay(overlayContext, cameraOverlay, cameraPreview, landmarks) {
  if (!overlayContext || !cameraOverlay) return;

  syncOverlaySize(cameraOverlay, cameraPreview);
  clearOverlay(overlayContext, cameraOverlay);

  const w = cameraOverlay.width;
  const h = cameraOverlay.height;

  // ── Lớp 1: Lưới tam giác toàn mặt (rất mờ, tạo cảm giác mask) ──────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, w, h, {
    color: "rgba(0, 229, 255, 0.12)",
    lineWidth: 0.6,
  });

  // ── Lớp 2: Viền ngoài khuôn mặt ─────────────────────────────────────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, w, h, {
    color: "rgba(0, 229, 255, 0.75)",
    lineWidth: 1.8,
  });

  // ── Lớp 3: Lông mày ──────────────────────────────────────────────────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, w, h, {
    color: "rgba(0, 229, 255, 0.9)",
    lineWidth: 1.5,
  });
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, w, h, {
    color: "rgba(0, 229, 255, 0.9)",
    lineWidth: 1.5,
  });

  // ── Lớp 4: Viền mắt ──────────────────────────────────────────────────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, w, h, {
    color: "rgba(0, 229, 255, 1)",
    lineWidth: 1.5,
  });
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, w, h, {
    color: "rgba(0, 229, 255, 1)",
    lineWidth: 1.5,
  });

  // ── Lớp 5: Iris (tròng mắt) ──────────────────────────────────────────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, w, h, {
    color: "rgba(255, 255, 255, 0.85)",
    lineWidth: 1.2,
  });
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, w, h, {
    color: "rgba(255, 255, 255, 0.85)",
    lineWidth: 1.2,
  });

  // ── Lớp 6: Môi ───────────────────────────────────────────────────────────
  drawMeshConnections(overlayContext, landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, w, h, {
    color: "rgba(120, 255, 165, 0.9)",
    lineWidth: 1.5,
  });
}

/**
 * Vẽ một tập hợp connection lines từ danh sách kết nối của MediaPipe.
 * Tất cả connections trong cùng một lần beginPath/stroke để tối ưu performance.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array}   landmarks   - Mảng 478 landmark {x, y}
 * @param {Array}   connections - Mảng {start: number, end: number} từ FaceLandmarker
 * @param {number}  w           - Chiều rộng canvas (pixel)
 * @param {number}  h           - Chiều cao canvas (pixel)
 * @param {{ color: string, lineWidth: number }} style
 */
function drawMeshConnections(ctx, landmarks, connections, w, h, style) {
  if (!connections?.length) return;

  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.beginPath();

  for (const conn of connections) {
    const a = landmarks[conn.start];
    const b = landmarks[conn.end];
    if (!a || !b) continue;

    // X đảo ngược (1 - x) vì video selfie bị mirror
    ctx.moveTo((1 - a.x) * w, a.y * h);
    ctx.lineTo((1 - b.x) * w, b.y * h);
  }

  ctx.stroke();
}

// ─── Private: Eye Look Smoothing ─────────────────────────────────────────────

// ─── Private: Eye Look Weights ────────────────────────────────────────────────

/**
 * Tính trọng số nhìn 4 hướng và góc xoay của một mắt từ vị trí iris.
 *
 * Thuật toán:
 *  1. Tính tâm iris từ 5 điểm iris
 *  2. Tính tâm mắt (midpoint inner-outer)
 *  3. Tính offset ngang và dọc của iris so với tâm mắt
 *  4. Normalize bằng kích thước mắt (eyeWidth, eyeHeight)
 *  5. Tách thành up/down/inward/outward (clamp về [0,1])
 *  6. Tính góc xoay rotation cho 3D bone eye
 *
 * @param {Array}  landmarks - 478 điểm
 * @param {Object} indices   - Chỉ số landmark của mắt đang xét
 * @param {string} side      - "left" | "right" (ảnh hưởng hướng inward/outward)
 * @returns {EyeLookWeights|null} null nếu thiếu dữ liệu
 */
function getEyeLookWeights(landmarks, indices, side) {

  // Lấy điểm viền mắt + 5 điểm iris từ mảng landmarks
  const inner = landmarks[indices.inner];
  const outer = landmarks[indices.outer];
  const upper = landmarks[indices.upper];
  const lower = landmarks[indices.lower];

  const irisPoints = indices.iris.map((index) => landmarks[index]).filter(Boolean);


  if (!inner || !outer || !upper || !lower || irisPoints.length !== indices.iris.length) {
    return null;
  }

  // Tính tâm
  const irisCenter = averagePoints(irisPoints);  // tâm iris
  const eyeHCenter = midpoint(inner, outer);     // tâm NGANG (inner↔outer) — dùng cho X
  const eyeVCenter = midpoint(upper, lower);     // tâm DỌC  (upper↔lower) — dùng cho Y

  // Kích thước mắt làm đơn vị chuẩn
  const eyeWidth  = Math.max(distance2D(inner, outer), 0.001);
  const eyeHeight = Math.max(distance2D(upper, lower), 0.001);

  // Offset normalize: [-1, 1]
  //  horizontal > 0 = iris lệch phải  (camera)
  //  vertical   > 0 = iris lệch xuống (screen y↓)
  const horizontal = THREE.MathUtils.clamp((irisCenter.x - eyeHCenter.x) / (eyeWidth  * 0.28), -1, 1);
  const vertical   = THREE.MathUtils.clamp((irisCenter.y - eyeVCenter.y) / (eyeHeight * 0.55), -1, 1);

  const outward = side === "left" ? Math.max(horizontal, 0) : Math.max(-horizontal, 0);
  const inward = side === "left" ? Math.max(-horizontal, 0) : Math.max(horizontal, 0);

  return {
    outward: THREE.MathUtils.clamp(outward, 0, 1),
    inward:  THREE.MathUtils.clamp(inward,  0, 1),
    up:      THREE.MathUtils.clamp(Math.max(-vertical, 0) * 0.90, 0, 1),
    down:    THREE.MathUtils.clamp(Math.max( vertical, 0) * 0.90, 0, 1),
    rotationPitch: THREE.MathUtils.clamp(vertical    * 0.45, -0.28, 0.28),
    rotationYaw:   THREE.MathUtils.clamp(-horizontal * 1.35, -0.72, 0.72),
  };
}


/** Tính điểm giữa của hai điểm 2D */
function midpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

/** Tính điểm trung bình (centroid) của một mảng điểm 2D */
function averagePoints(points) {
  if (!points.length) return null;
  let sumX = 0, sumY = 0;
  for (const point of points) { sumX += point.x; sumY += point.y; }
  return { x: sumX / points.length, y: sumY / points.length };
}

/** Khoảng cách Euclidean 2D giữa hai điểm */
function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Tính tâm của bounding box toàn bộ landmark (dùng cho positionYaw bias) */
function getLandmarkBoundsCenter(landmarks) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 };
}

