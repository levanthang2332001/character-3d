# Model Setup — GLTF rig, bone lookup, worldScale

> Yêu cầu model GLTF/GLB cho HoloBox + cách load, build bone map, đo length, tính worldScale, tìm morph mesh, capture eye base quaternion, calibration.

**When to read**: Phase 1 — viết `character_setup.js`. Hoặc khi load model mới gặp vấn đề bone/scale/morph.

---

## Yêu cầu model

Model GLTF/GLB cần có:

- **Skinned mesh** với skeleton đầy đủ
- **T-pose** (hoặc A-pose) làm bind pose
- **Tên bone theo chuẩn** (xem §1)
- **Morph target** cho 52 blendshape trên mesh mặt

---

## 1. Bone naming convention

Dùng chuẩn **VRM / Mixamo-compatible** để tương thích rộng nhất:

```
Hips
├── Spine           (= Spine0)
│   └── Chest       (= Spine1)
│       └── UpperChest  (= Spine2)
│           ├── Neck
│           │   └── Head
│           │       ├── LeftEye
│           │       └── RightEye
│           ├── LeftShoulder
│           │   └── LeftUpperArm
│           │       └── LeftLowerArm
│           │           └── LeftHand
│           │               ├── LeftThumbMetacarpal → LeftThumbProximal → LeftThumbDistal
│           │               ├── LeftIndexProximal → LeftIndexIntermediate → LeftIndexDistal
│           │               ├── LeftMiddleProximal → LeftMiddleIntermediate → LeftMiddleDistal
│           │               ├── LeftRingProximal → LeftRingIntermediate → LeftRingDistal
│           │               └── LeftLittleProximal → LeftLittleIntermediate → LeftLittleDistal
│           └── RightShoulder → (tương tự)
├── LeftUpperLeg → LeftLowerLeg → LeftFoot → LeftToes
└── RightUpperLeg → RightLowerLeg → RightFoot → RightToes
```

Nếu dùng Mixamo, prefix là `mixamorig` (vd `mixamorigLeftArm`). Code `script/animation/arm.js` có pattern fallback đa naming — copy cho controller mới.

---

## 2. Build bone map

```js
function buildBoneMap(model) {
  const boneMap = {};

  model.traverse((object) => {
    if (object.isBone || object.isSkinnedMesh) {
      boneMap[object.name] = object;
    }
    if (object.type === "Bone" || (object.isMesh && object.skeleton)) {
      boneMap[object.name] = object;
    }
  });

  return boneMap;
}

loader.load("character.glb", (gltf) => {
  const model = gltf.scene;
  const bones = buildBoneMap(model);

  const required = ["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
                    "LeftUpperArm", "LeftLowerArm", "LeftHand",
                    "RightUpperArm", "RightLowerArm", "RightHand",
                    "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
                    "RightUpperLeg", "RightLowerLeg", "RightFoot"];

  required.forEach(name => {
    if (!bones[name]) console.warn(`⚠️ Bone không tìm thấy: "${name}"`);
  });
});
```

---

## 3. Debug — in tất cả tên bones

```js
function listAllBones(model) {
  console.log("=== BONE LIST ===");
  model.traverse((obj) => {
    if (!obj.isBone) return;
    const chain = [];
    let current = obj;
    while (current) {
      chain.unshift(current.name || "(unnamed)");
      current = current.parent;
    }
    console.log(chain.join(" > "));
  });
}
```

---

## 4. Đo độ dài bones (cho IK)

[arm.md](../03-body-parts/arm.md) và [leg.md](../03-body-parts/leg.md) cần `upperArmLength`, `lowerArmLength`, etc. Đo **một lần khi load**:

```js
function measureBoneLengths(bones) {
  function boneLength(parent, child) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    parent.getWorldPosition(a);
    child.getWorldPosition(b);
    return a.distanceTo(b);
  }

  return {
    leftUpperArmLength:  boneLength(bones.LeftUpperArm,  bones.LeftLowerArm),
    leftLowerArmLength:  boneLength(bones.LeftLowerArm,  bones.LeftHand),
    rightUpperArmLength: boneLength(bones.RightUpperArm, bones.RightLowerArm),
    rightLowerArmLength: boneLength(bones.RightLowerArm, bones.RightHand),

    leftUpperLegLength:  boneLength(bones.LeftUpperLeg,  bones.LeftLowerLeg),
    leftLowerLegLength:  boneLength(bones.LeftLowerLeg,  bones.LeftFoot),
    rightUpperLegLength: boneLength(bones.RightUpperLeg, bones.RightLowerLeg),
    rightLowerLegLength: boneLength(bones.RightLowerLeg, bones.RightFoot),

    hipToChest:   boneLength(bones.Hips, bones.UpperChest),
    chestToHead:  boneLength(bones.UpperChest, bones.Head),
  };
}
```

> **Quan trọng**: phải `scene.add(model)` + `model.updateWorldMatrix(true, true)` trước khi đo, nếu không `getWorldPosition` trả về local.

---

## 5. WorldScale — Convert MediaPipe → Three.js world

MediaPipe Pose `worldLandmarks` đơn vị **mét thực tế**, gốc tại hips. Cần scale theo kích thước model:

```js
function computeWorldScale(bones, boneLengths) {
  const modelHeight = boneLengths.hipToChest + boneLengths.chestToHead;

  const lS = new THREE.Vector3(), rS = new THREE.Vector3();
  bones.LeftShoulder.getWorldPosition(lS);
  bones.RightShoulder.getWorldPosition(rS);
  const modelShoulderWidth = lS.distanceTo(rS);

  const REAL_BODY_HEIGHT    = 1.65;       // m (hips → đầu)
  const REAL_SHOULDER_WIDTH = 0.45;       // m

  return {
    x: modelShoulderWidth / REAL_SHOULDER_WIDTH,
    y: modelHeight        / REAL_BODY_HEIGHT,
    z: modelShoulderWidth / REAL_SHOULDER_WIDTH,        // dùng X làm proxy depth
  };
}

// Convert landmark:
// worldPos.x = -poseLandmark.x * worldScale.x;          // mirror X
// worldPos.y =  poseLandmark.y * worldScale.y;
// worldPos.z = -poseLandmark.z * worldScale.z;
```

---

## 6. Base quaternion cho mắt

`eye_control.js` cần `baseQuaternion` là rotation gốc của eye bone trong T-pose:

```js
function captureEyeBaseQuaternions(bones) {
  // Gọi sau khi load model, TRƯỚC frame animate đầu tiên
  return {
    leftEye:  bones.LeftEye.quaternion.clone(),
    rightEye: bones.RightEye.quaternion.clone(),
  };
}
```

Khi xoay: `eyeBone.quaternion.copy(baseQ).multiply(deltaQ)` — không drift.

---

## 7. Morph target map

Morph target nằm trên `SkinnedMesh` (thường là mesh mặt):

```js
function findMorphMesh(model) {
  let morphMesh = null;
  model.traverse((obj) => {
    if (obj.isMesh && obj.morphTargetDictionary) {
      const count = Object.keys(obj.morphTargetDictionary).length;
      if (count > 10) morphMesh = obj;                  // >10 targets → mesh mặt
    }
  });
  return morphMesh;
}

function buildMorphMap(mesh) {
  return mesh.morphTargetDictionary;                    // { "eyeBlink_L": 0, "jawOpen": 1, ... }
}

function setMorph(mesh, morphMap, name, value) {
  const idx = morphMap[name];
  if (idx !== undefined) {
    mesh.morphTargetInfluences[idx] = THREE.MathUtils.clamp(value, 0, 1);
  }
}
```

---

## 8. All-in-one initCharacter

```js
async function initCharacter(glbPath) {
  const gltf  = await loadGLTF(glbPath);
  const model = gltf.scene;
  scene.add(model);
  model.updateWorldMatrix(true, true);

  const bones        = buildBoneMap(model);
  const boneLengths  = measureBoneLengths(bones);
  const worldScale   = computeWorldScale(bones, boneLengths);
  const eyeBase      = captureEyeBaseQuaternions(bones);
  const morphMesh    = findMorphMesh(model);
  const morphMap     = buildMorphMap(morphMesh);

  console.log("✅ Bones loaded:", Object.keys(bones).length);
  console.log("📐 WorldScale:", worldScale);
  console.log("📏 BoneLengths:", boneLengths);
  console.log("😊 MorphTargets:", Object.keys(morphMap).length);

  return { model, bones, boneLengths, worldScale, eyeBase, morphMesh, morphMap };
}
```

---

## 9. Neutral pose calibration

Thu 30 frame đầu để tính neutral (đứng thẳng nhìn thẳng):

```js
const CALIBRATION_FRAMES = 30;
let calibrationBuffer = { shoulderHipDiff: [] };
let isCalibrated = false;

function collectCalibration(poseWorldLandmarks) {
  if (isCalibrated) return;

  const lS = poseWorldLandmarks[11];
  const rS = poseWorldLandmarks[12];
  const lH = poseWorldLandmarks[23];
  const rH = poseWorldLandmarks[24];
  if (!lS || !rS) return;

  const shoulderY = (lS.y + rS.y) / 2;
  const hipY      = (lH.y + rH.y) / 2;
  calibrationBuffer.shoulderHipDiff.push(shoulderY - hipY);

  if (calibrationBuffer.shoulderHipDiff.length >= CALIBRATION_FRAMES) {
    const sum = calibrationBuffer.shoulderHipDiff.reduce((a, b) => a + b, 0);
    spineState.neutralShoulderHipDiff = sum / CALIBRATION_FRAMES;
    isCalibrated = true;
    console.log("✅ Calibration done:", spineState.neutralShoulderHipDiff);
  }
}
```

---

## Lưu ý quan trọng

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Bone không tìm thấy | Tên trong model khác convention | `listAllBones()` debug, fallback đa naming như `arm.js` |
| WorldScale sai | Model scale ≠ 1 | `model.updateWorldMatrix(true, true)` trước đo |
| Morph target không có | Mesh sai | Tìm mesh có nhiều morph target nhất |
| Eye bone quay sai | `baseQuaternion` capture sau khi đã animate | Capture trước frame đầu |
| IK length = 0 | Bone chưa add vào scene | `scene.add(model)` trước đo |

---

← Prev: [../01-tracking/face-tracking.md](../01-tracking/face-tracking.md) | **Up**: [README](../README.md) | Next: [animation-mixer.md →](animation-mixer.md)
