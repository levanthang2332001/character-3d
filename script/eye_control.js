import * as THREE from "three";

/**
 * Giới hạn góc xoay mắt (radian) để trông tự nhiên.
 * Vượt quá giới hạn này mắt sẽ trông bất thường.
 */
// TUNING NOTE:
//  - Mắt người thật: ngang ±35° khi nhìn hết góc, dọc ±20°.
//  - PITCH 0.35 (~20°): lên/xuống rõ ràng và tự nhiên.
//  - YAW   0.60 (~34°): trái/phải linh hoạt.
//  Chỉnh: quá mạnh → giảm; quá ít → tăng.
const EYE_PITCH_LIMIT = 0.28;  // ~16° lên/xuống — giới hạn vật lý của model
const EYE_YAW_LIMIT   = 0.72;  // ~41° trái/phải — khớp clamp rotationYaw trong face_tracking_utils

/**
 * Áp dụng góc xoay cho một mắt (left hoặc right).
 *
 * Cách tính:
 *  1. Clamp pitch/yaw trong giới hạn cho phép
 *  2. Tạo Euler → chuyển sang Quaternion (delta)
 *  3. eyeGroup.quaternion = delta * baseQuaternion
 *     (multiply ngược: delta trước, base sau → xoay trong không gian world)
 *
 * @param {THREE.Group|null}      eyeGroup       - Group node của mắt trong scene
 * @param {THREE.Quaternion|null} baseQuaternion - Quaternion trung tính khi load model
 * @param {number}                pitch          - Góc xoay dọc (+ = nhìn lên, - = nhìn xuống)
 * @param {number}                yaw            - Góc xoay ngang (+ = nhìn phải, - = nhìn trái)
 */
export function applyEyeRotation(eyeGroup, baseQuaternion, pitch, yaw) {
  if (!eyeGroup || !baseQuaternion) return;

  // Clamp góc để tránh xoay quá mức
  const clampedPitch = THREE.MathUtils.clamp(pitch, -EYE_PITCH_LIMIT, EYE_PITCH_LIMIT);
  const clampedYaw   = THREE.MathUtils.clamp(yaw,   -EYE_YAW_LIMIT,   EYE_YAW_LIMIT);

  // Tạo delta rotation từ pitch/yaw
  // # Check convert to Euler and Quaternion
  const deltaEuler      = new THREE.Euler(clampedPitch, clampedYaw, 0, "XYZ");
  const deltaQuaternion = new THREE.Quaternion().setFromEuler(deltaEuler);

  // Áp dụng: delta nhân với base → giữ đúng hướng gốc của model
  eyeGroup.quaternion.copy(deltaQuaternion).multiply(baseQuaternion);
}

/**
 * Đặt lại cả hai mắt về hướng trung tính (nhìn thẳng).
 *
 * @param {THREE.Group|null}      leftEyeGroup        - Group mắt trái
 * @param {THREE.Quaternion|null} leftEyeBaseQuaternion
 * @param {THREE.Group|null}      rightEyeGroup       - Group mắt phải
 * @param {THREE.Quaternion|null} rightEyeBaseQuaternion
 */
export function resetEyeRotation(leftEyeGroup, leftEyeBaseQuaternion, rightEyeGroup, rightEyeBaseQuaternion) {
  applyEyeRotation(leftEyeGroup,  leftEyeBaseQuaternion,  0, 0);
  applyEyeRotation(rightEyeGroup, rightEyeBaseQuaternion, 0, 0);
}
