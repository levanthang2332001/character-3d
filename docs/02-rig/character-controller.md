# Character Controller — Master Loop & Data Flow

> Module trung tâm gọi từng body-part controller theo đúng thứ tự mỗi frame; nhận input từ `trackingState`, output bone rotation + morph target.

**When to read**: Phase 5 — viết `character_controller.js`. Hoặc cần biết update order, sub-state nào ai quản lý.

---

## Tổng quan

`CharacterController` là module trung tâm kết nối tất cả hệ thống:
- Nhận input từ `TrackingState` (MediaPipe results)
- Gọi từng body-part module theo đúng thứ tự
- Output: cập nhật tất cả bone rotations + morph targets mỗi frame

---

## 1. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    MEDIAPIPE LAYER                       │
│  FaceLandmarker → faceResult                            │
│  PoseLandmarker → poseResult                            │
│  HandLandmarker → handResult                            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  TRACKING STATE                          │
│  trackingState.headEuler, eyeLeft, eyeRight             │
│  trackingState.spineInput (leanPitch, leanRoll)         │
│  trackingState.leftWristPos, rightWristPos              │
│  trackingState.leftAnklePos, rightAnklePos              │
│  trackingState.leftHandLandmarks, rightHandLandmarks    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              CHARACTER CONTROLLER                        │
│  updateCharacter(dt)                                    │
│    1. updateSpine(dt)      → bones.Hips/Spine*/UpperChest│
│    2. updateHeadNeck(dt)   → bones.Neck/Head            │
│    3. updateEyes(dt)       → bones.LeftEye/RightEye     │
│    4. updateMorphTargets() → mesh.morphTargetInfluences │
│    5. updateArm(left, dt)  → bones.LeftUpperArm/Lower.. │
│    6. updateArm(right, dt) → bones.RightUpperArm/Lower..│
│    7. updateHand(left, dt) → bones.LeftHand + fingers   │
│    8. updateHand(right,dt) → bones.RightHand + fingers  │
│    9. updateLeg(left, dt)  → bones.LeftUpperLeg/...     │
│   10. updateLeg(right, dt) → bones.RightUpperLeg/...    │
└─────────────────────────────────────────────────────────┘
```

---

## 2. CharacterController Object

```js
const CharacterController = {
  // References
  bones:       null,      // từ model_setup.md buildBoneMap()
  boneLengths: null,      // từ model_setup.md measureBoneLengths()
  worldScale:  null,      // từ model_setup.md computeWorldScale()
  morphMesh:   null,      // SkinnedMesh có morph targets
  morphMap:    null,      // { name: index }

  // Sub-states
  spineState:    createSpineState(),
  headNeckState: createHeadNeckState(),
  leftArm:       createArmState("left"),
  rightArm:      createArmState("right"),
  leftHand:      createHandState("left"),
  rightHand:     createHandState("right"),
  leftLeg:       createLegState("left"),
  rightLeg:      createLegState("right"),

  // Timing
  breathPhase: 0,
  idleTime:    0,
};
```

---

## 3. Master Update Function

```js
function updateCharacter(controller, trackingState, dt) {
  const { bones, boneLengths, worldScale } = controller;

  // ─── STEP 1: Parse MediaPipe input ───────────────────────
  parseTrackingInput(trackingState, worldScale);

  // ─── STEP 2: Cột sống (từ gốc lên ngọn) ─────────────────
  updateSpine(controller, trackingState, dt);

  // ─── STEP 3: Đầu và cổ ───────────────────────────────────
  updateHeadNeck(controller, trackingState, dt);

  // ─── STEP 4: Mắt ─────────────────────────────────────────
  updateEyes(controller, trackingState, dt);

  // ─── STEP 5: Morph targets (blendshapes mặt) ─────────────
  updateMorphTargets(controller, trackingState);

  // ─── STEP 6: Cánh tay (IK) ───────────────────────────────
  updateArm(controller.leftArm,  bones, boneLengths, trackingState, dt);
  updateArm(controller.rightArm, bones, boneLengths, trackingState, dt);

  // ─── STEP 7: Bàn tay và ngón tay ─────────────────────────
  updateHand(controller.leftHand,  bones, trackingState.leftHandLandmarks,  dt);
  updateHand(controller.rightHand, bones, trackingState.rightHandLandmarks, dt);

  // ─── STEP 8: Chân (IK) ───────────────────────────────────
  updateLeg(controller.leftLeg,  bones, boneLengths, trackingState, dt);
  updateLeg(controller.rightLeg, bones, boneLengths, trackingState, dt);

  // ─── STEP 9: Procedural nhịp thở (cộng vào cuối) ─────────
  controller.breathPhase += 2 * Math.PI * 0.25 * dt;  // 0.25Hz
  applyBreathingToSpine(bones, controller.breathPhase);
}
```

---

## 4. Parse Tracking Input

```js
function parseTrackingInput(trackingState, worldScale) {
  // ── Face ──────────────────────────────────────────────────
  const faceResult = trackingState.face;
  trackingState.faceDetected = faceResult?.faceLandmarks?.length > 0;

  if (trackingState.faceDetected) {
    const landmarks = faceResult.faceLandmarks[0];
    const euler = createHeadPoseFromLandmarks(landmarks);  // từ face_tracking_utils.js
    trackingState.headEuler = euler;

    const eyeLook = createEyeLookFromLandmarks(landmarks);
    trackingState.eyeLeft  = eyeLook.left;
    trackingState.eyeRight = eyeLook.right;
  }

  // ── Pose ──────────────────────────────────────────────────
  const poseResult = trackingState.pose;
  trackingState.poseDetected = poseResult?.worldLandmarks?.length > 0;

  if (trackingState.poseDetected) {
    const wl = poseResult.worldLandmarks[0];  // world landmarks (meters)

    // Spine lean
    trackingState.spineInput = computeSpineLeanFromPose(wl);

    // Arm IK targets (worldLandmarks đã là meters, scale theo model)
    const scaleV = (lm, sign = 1) => new THREE.Vector3(
      -lm.x * worldScale.x * sign,
       lm.y * worldScale.y,
      -lm.z * worldScale.z,
    );

    if (isPoseLandmarkVisible(wl[15])) trackingState.leftWristPos  = scaleV(wl[15]);
    if (isPoseLandmarkVisible(wl[16])) trackingState.rightWristPos = scaleV(wl[16]);
    if (isPoseLandmarkVisible(wl[27])) trackingState.leftAnklePos  = scaleV(wl[27]);
    if (isPoseLandmarkVisible(wl[28])) trackingState.rightAnklePos = scaleV(wl[28]);
  }

  // ── Hands ─────────────────────────────────────────────────
  parseHandResult(trackingState.hand, trackingState);  // từ mediapipe_setup.md §9
}
```

---

## 5. updateSpine

```js
function updateSpine(controller, trackingState, dt) {
  const { bones, spineState } = controller;

  // Lấy lean từ Pose hoặc procedural fallback
  const lean = trackingState.poseDetected
    ? trackingState.spineInput
    : { pitch: 0, roll: 0 };

  // Lerp lean
  spineState.leanCurrent.pitch = THREE.MathUtils.lerp(spineState.leanCurrent.pitch, lean.pitch, 0.1);
  spineState.leanCurrent.roll  = THREE.MathUtils.lerp(spineState.leanCurrent.roll,  lean.roll,  0.1);

  // Phân phối lên chain (từ spine.md §1)
  const SPINE_WEIGHTS = [0.20, 0.25, 0.30, 0.25];
  const spineKeys = ["Hips", "Spine", "Chest", "UpperChest"];

  spineKeys.forEach((name, i) => {
    if (!bones[name]) return;
    bones[name].rotation.x = spineState.leanCurrent.pitch * SPINE_WEIGHTS[i];
    bones[name].rotation.z = spineState.leanCurrent.roll  * SPINE_WEIGHTS[i];
  });

  // Twist theo head yaw (từ spine.md §4)
  applySpineTwist(bones, spineState, trackingState.headEuler?.yaw ?? 0);

  // Idle sway (từ spine.md §5)
  applyIdleSpineSway(bones, controller.idleTime);
  controller.idleTime += dt;
}
```

---

## 6. updateHeadNeck

```js
function updateHeadNeck(controller, trackingState, dt) {
  const { bones, headNeckState: s } = controller;

  const target = trackingState.faceDetected
    ? trackingState.headEuler
    : getIdleHeadTarget(controller.idleTime);

  // Clamp (từ head_neck.md §3)
  const clamped = {
    pitch: THREE.MathUtils.clamp(target.pitch, -0.55, 0.45),
    yaw:   THREE.MathUtils.clamp(target.yaw,   -0.70, 0.70),
    roll:  THREE.MathUtils.clamp(target.roll,  -0.30, 0.30),
  };

  // Spring damper cho neck (từ head_neck.md §4)
  const STIFFNESS = 18, DAMPING = 6;
  ["yaw", "pitch"].forEach(axis => {
    const force = -STIFFNESS * (s[axis] - clamped[axis]) - DAMPING * s[`v_${axis}`];
    s[`v_${axis}`] += force * dt;
    s[axis]        += s[`v_${axis}`] * dt;
  });

  // Phân phối Neck 35% / Head 65%
  const HEAD_RATIO = 0.65, NECK_RATIO = 0.35;

  if (bones["Neck"]) {
    bones["Neck"].rotation.set(
      s.pitch  * NECK_RATIO,
      s.yaw    * NECK_RATIO,
      clamped.roll * NECK_RATIO,
      "YXZ"
    );
  }
  if (bones["Head"]) {
    // Thêm head bob thở (từ head_neck.md §5)
    const breathBob = Math.sin(controller.breathPhase) * 0.008;
    bones["Head"].rotation.set(
      clamped.pitch * HEAD_RATIO + breathBob,
      clamped.yaw   * HEAD_RATIO,
      clamped.roll,
      "YXZ"
    );
  }
}
```

---

## 7. updateEyes

```js
function updateEyes(controller, trackingState, dt) {
  const { bones, eyeBase } = controller;

  const left  = trackingState.eyeLeft  ?? { pitch: 0, yaw: 0 };
  const right = trackingState.eyeRight ?? { pitch: 0, yaw: 0 };

  // Dùng eye_control.js
  if (bones["LeftEye"])  applyEyeRotation(bones["LeftEye"],  eyeBase.leftEye,  left.pitch,  left.yaw);
  if (bones["RightEye"]) applyEyeRotation(bones["RightEye"], eyeBase.rightEye, right.pitch, right.yaw);
}
```

---

## 8. updateMorphTargets

```js
function updateMorphTargets(controller, trackingState) {
  const { morphMesh, morphMap } = controller;
  if (!morphMesh || !trackingState.faceDetected) return;

  const blendshapes = trackingState.face.faceBlendshapes?.[0]?.categories;
  if (!blendshapes) return;

  // Dùng BLENDSHAPE_MAP từ face_tracking_utils.js
  blendshapes.forEach(({ categoryName, score }) => {
    const morphName = BLENDSHAPE_MAP[categoryName];
    if (morphName) setMorph(morphMesh, morphMap, morphName, score);
  });
}
```

---

## 9. updateArm

```js
function updateArm(armState, bones, boneLengths, trackingState, dt) {
  const isLeft = armState.side === "left";

  // Lấy wrist target
  const rawTarget = isLeft
    ? trackingState.leftWristPos
    : trackingState.rightWristPos;

  // Fallback về idle nếu không có Pose
  const poseAvailable = rawTarget && trackingState.poseDetected;
  const idleTarget = isLeft
    ? new THREE.Vector3(-0.18, -0.55, 0.05)
    : new THREE.Vector3(+0.18, -0.55, 0.05);

  const targetWorld = poseAvailable
    ? rawTarget
    : bones["Hips"].localToWorld(idleTarget.clone());

  // Lerp để mượt
  armState.currentTarget.lerp(targetWorld, 0.25);

  // Lấy bone refs
  const prefix = isLeft ? "Left" : "Right";
  const shoulder  = bones[`${prefix}Shoulder`];
  const upperArm  = bones[`${prefix}UpperArm`];
  const lowerArm  = bones[`${prefix}LowerArm`];
  const hand      = bones[`${prefix}Hand`];

  if (!upperArm || !lowerArm) return;

  // Giải IK (từ arm.md §1-3)
  const shoulderPos = new THREE.Vector3();
  upperArm.parent.getWorldPosition(shoulderPos);

  const upper = isLeft ? boneLengths.leftUpperArmLength  : boneLengths.rightUpperArmLength;
  const lower = isLeft ? boneLengths.leftLowerArmLength  : boneLengths.rightLowerArmLength;

  applyArmIK(upperArm, lowerArm, shoulderPos, upper, lower, armState.currentTarget, armState.poleTarget);

  // Shoulder droop (từ arm.md §4)
  if (shoulder) {
    const droop = THREE.MathUtils.clamp((shoulderPos.y - armState.currentTarget.y) * 0.2, 0, 0.15);
    shoulder.rotation.z = isLeft ? droop : -droop;
  }
}
```

---

## 10. updateHand

```js
function updateHand(handState, bones, handLandmarks, dt) {
  const prefix = handState.side === "left" ? "Left" : "Right";

  if (!handLandmarks) {
    // Fallback về idle pose
    blendHandToPreset(handState, HAND_POSES.idle, dt);
  } else {
    // Tính curl/spread từ landmarks (từ hand.md §4-5)
    const targetPose = computeHandPoseFromLandmarks(handLandmarks);
    blendHandToPreset(handState, targetPose, dt);
  }

  // Áp lên bones
  applyHandPoseToBones(handState, bones, prefix);
}
```

---

## 11. updateLeg

```js
function updateLeg(legState, bones, boneLengths, trackingState, dt) {
  const isLeft  = legState.side === "left";
  const prefix  = isLeft ? "Left" : "Right";

  // Foot target
  const rawAnkle = isLeft
    ? trackingState.leftAnklePos
    : trackingState.rightAnklePos;

  const poseAvailable = rawAnkle && trackingState.poseDetected;
  const defaultFootTarget = isLeft
    ? new THREE.Vector3(-0.12, -1.0, 0)
    : new THREE.Vector3(+0.12, -1.0, 0);

  const ankleTarget = poseAvailable
    ? rawAnkle
    : bones["Hips"].localToWorld(defaultFootTarget.clone());

  // Snap về đất
  const groundNormal = snapFootToGround(ankleTarget, scene, raycaster);
  legState.currentTarget.lerp(ankleTarget, 0.2);

  // Bones
  const upperLeg = bones[`${prefix}UpperLeg`];
  const lowerLeg = bones[`${prefix}LowerLeg`];
  const foot     = bones[`${prefix}Foot`];

  if (!upperLeg || !lowerLeg) return;

  // Lấy vị trí hip
  const hipPos = new THREE.Vector3();
  upperLeg.parent.getWorldPosition(hipPos);

  const upper = isLeft ? boneLengths.leftUpperLegLength  : boneLengths.rightUpperLegLength;
  const lower = isLeft ? boneLengths.leftLowerLegLength  : boneLengths.rightLowerLegLength;

  applyLegIK(upperLeg, lowerLeg, hipPos, upper, lower, legState.currentTarget, legState.poleTarget);

  // Foot alignment (từ leg.md §3)
  if (foot) alignFootToGround(foot, groundNormal, legState.currentTarget);
}
```

---

## 12. createSpineState / createArmState / etc.

```js
function createSpineState() {
  return {
    leanTarget:  { pitch: 0, roll: 0 },
    leanCurrent: { pitch: 0, roll: 0 },
    twistCurrent: 0,
    neutralShoulderHipDiff: 0.30,
  };
}

function createHeadNeckState() {
  return {
    yaw: 0, pitch: 0,
    v_yaw: 0, v_pitch: 0,
  };
}

function createArmState(side) {
  return {
    side,
    currentTarget: new THREE.Vector3(side === "left" ? -0.18 : 0.18, -0.55, 0.05),
    poleTarget: new THREE.Vector3(side === "left" ? -1 : 1, -0.3, 0.5),
  };
}

function createHandState(side) {
  return {
    side,
    poseCurrent: {
      thumb:  { curl: 0.15, spread: 0.1 },
      index:  { curl: 0.12, spread: 0.05 },
      middle: { curl: 0.14, spread: 0 },
      ring:   { curl: 0.16, spread: -0.05 },
      little: { curl: 0.18, spread: -0.12 },
    },
  };
}

function createLegState(side) {
  return {
    side,
    currentTarget: new THREE.Vector3(side === "left" ? -0.12 : 0.12, -1.0, 0),
    poleTarget: new THREE.Vector3(side === "left" ? -0.05 : 0.05, 0, 0.8),
    stepPhase: side === "left" ? 0 : Math.PI,
    isGrounded: true,
  };
}
```

---

## 13. Tích hợp vào render loop (Three.js)

```js
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt  = Math.min((now - lastTime) / 1000, 0.05);  // clamp dt <= 50ms
  lastTime  = now;

  // 1. Chạy character update
  updateCharacter(characterController, trackingState, dt);

  // 2. Render
  renderer.render(scene, camera);
}

animate();
```

---

## Lưu ý quan trọng

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| dt spike (lag frame) | Tab bị ẩn, resume | Clamp `dt = Math.min(dt, 0.05)` |
| Bones không update | updateWorldMatrix chưa chạy | Three.js tự cập nhật trong render, không cần gọi thủ công |
| IK lật tay/chân | Thiếu pole vector | Luôn set poleTarget hợp lý (xem [../03-body-parts/arm.md](../03-body-parts/arm.md), [../03-body-parts/leg.md](../03-body-parts/leg.md)) |
| Morph targets không hoạt động | morphMesh sai | Dùng `findMorphMesh()` từ [model-setup.md](model-setup.md) |
| Arm/leg không theo tracking | worldScale sai | Kiểm tra lại `computeWorldScale()` |

---

← Prev: [animation-retargeting.md](animation-retargeting.md) | **Up**: [README](../README.md) | Next: [../03-body-parts/head-neck.md →](../03-body-parts/head-neck.md)
