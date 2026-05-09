import * as THREE from "three";

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TEMP_QUATERNION = new THREE.Quaternion();
const BASE_UPPER_ARM_QUATERNION = new THREE.Quaternion();
const BASE_LOWER_ARM_QUATERNION = new THREE.Quaternion();
const BASE_HAND_QUATERNION = new THREE.Quaternion();

const gestureState = {
  bones: null,
  active: false,
  time: 0,
  duration: 1.8,
};

const RIGHT_HAND_HELLO_CONFIG = {
  duration: 1.8, // Thời gian hoàn thành gesture
  raiseEnd: 0.5, // Thời điểm kết thúc nâng tay
  waveEnd: 0.3, // Thời điểm kết thúc lắc tay
  raiseWeight: 1, // Trọng số nâng tay
  waveWeight: 0.6, // Trọng số lắc tay
  upperArmLift: -2.0, // Độ nâng của vai
  upperArmForward: -0.2,
  elbowBend: -0.8, // Độ gập của khuỷu tay
  waveSpeed: 14, // Tốc độ lắc tay
  waveAmount: 0.3,
}; // Độ lớn lắc tay

export function initArmGestureSystem(model) {
  // Cache bone refs một lần sau khi model đã mount vào scene.
  gestureState.bones = buildBoneMap(model);
  window.addEventListener("keydown", onGestureKeyDown);
}

export function playRightHandHello() {
  gestureState.active = true;
  gestureState.time = 0;
  gestureState.duration = RIGHT_HAND_HELLO_CONFIG.duration;
}

export function updateArmGestures(dt) {
  // Chỗ này là entry point để character loop gọi mỗi frame.
  updateRightHandHello(dt);
}

export function getRightHandHelloConfig() {
  return RIGHT_HAND_HELLO_CONFIG;
}

function buildBoneMap(model) {
  const bones = {};
  model.traverse((object) => {
    if (object.isBone) {
      bones[object.name] = object;
    }
  });
  console.log("Bones:", bones);
  return bones;
}

function onGestureKeyDown(event) {
  if (event.code === "KeyH") {
    playRightHandHello();
  }
}

function easeInOut01(x) {
  x = THREE.MathUtils.clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
}

function applyQuaternionOffset(bone, axis, angle) {
  TEMP_QUATERNION.setFromAxisAngle(axis, angle);
  bone.quaternion.multiply(TEMP_QUATERNION);
}

function getFirstExistingBone(bones, names) {
  for (const name of names) {
    if (bones[name]) return bones[name];
  }
  return null;
}

function getRightArmBones() {
  if (!gestureState.bones) return null;

  // Hỗ trợ cả naming kiểu generic lẫn Mixamo.
  const upperArm = getFirstExistingBone(gestureState.bones, [
    "RightUpperArm",
    "RightArm",
    "mixamorigRightArm",
    "mixamorig:RightArm",
  ]);
  const lowerArm = getFirstExistingBone(gestureState.bones, [
    "RightLowerArm",
    "RightForeArm",
    "mixamorigRightForeArm",
    "mixamorig:RightForeArm",
  ]);
  const hand = getFirstExistingBone(gestureState.bones, [
    "RightHand",
    "mixamorigRightHand",
    "mixamorig:RightHand",
  ]);

  if (!upperArm || !lowerArm || !hand) return null;
  return { upperArm, lowerArm, hand };
}

function updateRightHandHello(dt) {
  if (!gestureState.active || !gestureState.bones) return;

  const rightArm = getRightArmBones();
  if (!rightArm) return;

  // Snapshot pose của frame hiện tại để offset không bị cộng dồn giữa các frame.
  BASE_UPPER_ARM_QUATERNION.copy(rightArm.upperArm.quaternion);
  BASE_LOWER_ARM_QUATERNION.copy(rightArm.lowerArm.quaternion);
  BASE_HAND_QUATERNION.copy(rightArm.hand.quaternion);

  gestureState.time += dt;
  const t = gestureState.time / gestureState.duration;

  if (t >= 1) {
    gestureState.active = false;
    return;
  }

  let raiseWeight = 0;
  let waveWeight = 0;
  let returnWeight = 0;

  // Timeline 3 phase: đưa tay lên, giữ/lắc tay, rồi hạ tay xuống.
  if (t < RIGHT_HAND_HELLO_CONFIG.raiseEnd) {
    raiseWeight = easeInOut01(t / RIGHT_HAND_HELLO_CONFIG.raiseEnd);
  } else if (t < RIGHT_HAND_HELLO_CONFIG.waveEnd) {
    raiseWeight = RIGHT_HAND_HELLO_CONFIG.raiseWeight;
    waveWeight = RIGHT_HAND_HELLO_CONFIG.waveWeight;
  } else {
    raiseWeight = RIGHT_HAND_HELLO_CONFIG.raiseWeight;
    returnWeight = easeInOut01(
      (t - RIGHT_HAND_HELLO_CONFIG.waveEnd) /
        (1 - RIGHT_HAND_HELLO_CONFIG.waveEnd),
    );
  }

  const finalWeight = raiseWeight * (1 - returnWeight);

  // Cộng offset sau mixer để gesture đè lên body pose hiện tại.
  rightArm.upperArm.quaternion.copy(BASE_UPPER_ARM_QUATERNION);
  applyQuaternionOffset(
    rightArm.upperArm,
    AXIS_Z,
    RIGHT_HAND_HELLO_CONFIG.upperArmLift * finalWeight,
  );
  applyQuaternionOffset(
    rightArm.upperArm,
    AXIS_X,
    RIGHT_HAND_HELLO_CONFIG.upperArmForward * finalWeight,
  );

  rightArm.lowerArm.quaternion.copy(BASE_LOWER_ARM_QUATERNION);
  applyQuaternionOffset(
    rightArm.lowerArm,
    AXIS_X,
    RIGHT_HAND_HELLO_CONFIG.elbowBend * finalWeight,
  );

  rightArm.hand.quaternion.copy(BASE_HAND_QUATERNION);
  if (waveWeight > 0) {
    // Lắc bàn tay bằng dao động sin để ra cảm giác vẫy tay.
    const wave =
      Math.sin(gestureState.time * RIGHT_HAND_HELLO_CONFIG.waveSpeed) *
      RIGHT_HAND_HELLO_CONFIG.waveAmount *
      finalWeight;
    applyQuaternionOffset(rightArm.hand, AXIS_Y, wave);
  }
}
