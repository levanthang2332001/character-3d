---
name: character-rig
description: GLTF/GLB rig setup cho HoloLab — bone naming convention (VRM/Mixamo), buildBoneMap traverse, đo bone lengths cho IK, tính worldScale chuyển coords MediaPipe → Three.js, tìm morph target mesh, capture base quaternion cho mắt, calibrate neutral pose. Use this when the user asks "load model", "tìm bone", "bone không thấy", "tính độ dài tay/chân", "morph target nằm đâu", "MediaPipe coords không khớp model".
---

# Character Rig — Setup model GLB → bones / lengths / scale / morph

## Khi dùng skill này

Lần đầu load 1 model GLB mới, hoặc khi:
- IK target offset (tay/chân không tới đúng vị trí pose).
- Bone không tìm thấy / tên khác convention.
- Morph target không hoạt động.
- Eye bone xoay sai trục.

## Bone convention (VRM/Mixamo-compatible)

```
Hips
├── Spine → Chest → UpperChest
│   ├── Neck → Head → LeftEye / RightEye
│   ├── LeftShoulder → LeftUpperArm → LeftLowerArm → LeftHand → fingers (5)
│   └── RightShoulder → RightUpperArm → RightLowerArm → RightHand → fingers
├── LeftUpperLeg → LeftLowerLeg → LeftFoot → LeftToes
└── RightUpperLeg → RightLowerLeg → RightFoot → RightToes
```

Mixamo dùng prefix `mixamorig` (vd `mixamorigLeftArm`). Code trong `script/animation/arm.js` đã có pattern fallback đa naming — copy pattern đó:

```js
function getFirstExistingBone(bones, names) {
  for (const n of names) if (bones[n]) return bones[n];
  return null;
}
const upperArm = getFirstExistingBone(bones, [
  "RightUpperArm", "RightArm", "mixamorigRightArm", "mixamorig:RightArm",
]);
```

## Step 1 — buildBoneMap

```js
function buildBoneMap(model) {
  const map = {};
  model.traverse((obj) => {
    if (obj.isBone) map[obj.name] = obj;
  });
  return map;
}
```

Debug — in tất cả tên + parent chain để hiểu hierarchy:

```js
function listAllBones(model) {
  model.traverse((obj) => {
    if (!obj.isBone) return;
    const chain = [];
    let cur = obj;
    while (cur) { chain.unshift(cur.name || "(unnamed)"); cur = cur.parent; }
    console.log(chain.join(" > "));
  });
}
```

## Step 2 — measureBoneLengths (cho IK)

```js
function boneLength(parent, child) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  parent.getWorldPosition(a);
  child.getWorldPosition(b);
  return a.distanceTo(b);
}

function measureBoneLengths(bones) {
  return {
    leftUpperArmLength:  boneLength(bones.LeftUpperArm,  bones.LeftLowerArm),
    leftLowerArmLength:  boneLength(bones.LeftLowerArm,  bones.LeftHand),
    rightUpperArmLength: boneLength(bones.RightUpperArm, bones.RightLowerArm),
    rightLowerArmLength: boneLength(bones.RightLowerArm, bones.RightHand),
    leftUpperLegLength:  boneLength(bones.LeftUpperLeg,  bones.LeftLowerLeg),
    leftLowerLegLength:  boneLength(bones.LeftLowerLeg,  bones.LeftFoot),
    rightUpperLegLength: boneLength(bones.RightUpperLeg, bones.RightLowerLeg),
    rightLowerLegLength: boneLength(bones.RightLowerLeg, bones.RightFoot),
    hipToChest:          boneLength(bones.Hips, bones.UpperChest),
    chestToHead:         boneLength(bones.UpperChest, bones.Head),
  };
}
```

**Quan trọng:** Phải `scene.add(model)` và `model.updateWorldMatrix(true, true)` trước khi đo, nếu không getWorldPosition trả về local.

## Step 3 — worldScale (MediaPipe → Three.js)

MediaPipe Pose `worldLandmarks` đơn vị **mét** thực tế. Cần scale để khớp kích thước model:

```js
function computeWorldScale(bones, boneLengths) {
  const modelHeight = boneLengths.hipToChest + boneLengths.chestToHead;
  const lS = new THREE.Vector3(), rS = new THREE.Vector3();
  bones.LeftShoulder.getWorldPosition(lS);
  bones.RightShoulder.getWorldPosition(rS);
  const modelShoulderWidth = lS.distanceTo(rS);

  const REAL_BODY_HEIGHT    = 1.65;     // m (hips → đầu)
  const REAL_SHOULDER_WIDTH = 0.45;     // m

  return {
    x: modelShoulderWidth / REAL_SHOULDER_WIDTH,
    y: modelHeight        / REAL_BODY_HEIGHT,
    z: modelShoulderWidth / REAL_SHOULDER_WIDTH,        // dùng X làm proxy depth
  };
}
```

Dùng:
```js
worldPos.x = -poseLandmark.x * worldScale.x;            // mirror X (selfie)
worldPos.y =  poseLandmark.y * worldScale.y;
worldPos.z = -poseLandmark.z * worldScale.z;            // negate Z
```

## Step 4 — Morph mesh & map

Tìm mesh có nhiều morph target nhất (thường là face mesh):

```js
function findMorphMesh(model) {
  let found = null;
  model.traverse((obj) => {
    if (obj.isMesh && obj.morphTargetDictionary) {
      const n = Object.keys(obj.morphTargetDictionary).length;
      if (n > 10) found = obj;
    }
  });
  return found;
}

function setMorph(mesh, name, value) {
  const idx = mesh.morphTargetDictionary[name];
  if (idx !== undefined) {
    mesh.morphTargetInfluences[idx] = THREE.MathUtils.clamp(value, 0, 1);
  }
}
```

## Step 5 — Eye base quaternion

`eye_control.js` dùng quaternion offset để mắt không drift. Capture **trước frame đầu tiên animate**:

```js
function captureEyeBaseQuaternions(bones) {
  return {
    leftEye:  bones.LeftEye.quaternion.clone(),
    rightEye: bones.RightEye.quaternion.clone(),
  };
}

// Khi xoay mắt:
eyeBone.quaternion.copy(baseQ).multiply(deltaQ);
```

## Step 6 — Neutral calibration

Thu 30 frame đầu khi user đứng thẳng → tính offset trung tính (loại bias do camera angle):

```js
const CALIB_FRAMES = 30;
const buf = { shoulderHipDiff: [] };

function collectCalibration(wl) {                       // wl = pose worldLandmarks[0]
  const sY = (wl[11].y + wl[12].y) / 2;
  const hY = (wl[23].y + wl[24].y) / 2;
  buf.shoulderHipDiff.push(sY - hY);
  if (buf.shoulderHipDiff.length >= CALIB_FRAMES) {
    spineState.neutralShoulderHipDiff =
      buf.shoulderHipDiff.reduce((a, b) => a + b, 0) / CALIB_FRAMES;
    isCalibrated = true;
  }
}
```

## All-in-one initCharacter

```js
async function initCharacter(glbPath) {
  const gltf = await new GLTFLoader().loadAsync(glbPath);
  const model = gltf.scene;
  scene.add(model);
  model.updateWorldMatrix(true, true);

  const bones        = buildBoneMap(model);
  const boneLengths  = measureBoneLengths(bones);
  const worldScale   = computeWorldScale(bones, boneLengths);
  const eyeBase      = captureEyeBaseQuaternions(bones);
  const morphMesh    = findMorphMesh(model);

  console.log("Bones:", Object.keys(bones).length,
              "Morphs:", Object.keys(morphMesh.morphTargetDictionary).length,
              "Scale:", worldScale);

  return { model, bones, boneLengths, worldScale, eyeBase, morphMesh };
}
```

## Troubleshooting

| Lỗi | Fix |
|-----|-----|
| Bone undefined | `listAllBones()` xem tên thực; thêm fallback names như `arm.js` |
| Length = 0 | Quên `scene.add(model)` trước đo; hoặc `updateWorldMatrix` chưa chạy |
| WorldScale lệch | Model có scale ≠ 1 ở root; gọi `model.updateMatrixWorld(true)` |
| Morph không hoạt động | Set sai mesh; dùng `findMorphMesh` lọc mesh có ≥10 targets |
| Eye drift dần | Quên capture base quaternion trước frame 0; hoặc set rotation thay vì multiply quaternion |

## Reference

- Doc đầy đủ: `docs/02-rig/model-setup.md`.
- Pattern fallback bone naming: `script/animation/arm.js` `getFirstExistingBone`.
- Convention chi tiết: `docs/00-overview/glossary.md` §12 (Bone & Quaternion).
