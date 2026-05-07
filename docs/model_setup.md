# Model Setup — GLTF Rig, Bone Lookup, WorldScale

## Yêu cầu model GLTF cho HoloBox character

Model GLTF/GLB cần có:
- **Skinned mesh** với skeleton đầy đủ
- **T-pose** (hoặc A-pose) làm bind pose
- **Tên bone theo chuẩn** (xem bảng bên dưới)
- **Morph targets** cho 52 blendshapes trên mesh mặt

---

## 1. Chuẩn tên bone (Convention)

Dùng chuẩn **VRM / Mixamo-compatible** để tương thích rộng nhất:

```
Hips
├── Spine           (= Spine0)
│   └── Chest       (= Spine1)
│       └── UpperChest  (= Spine2)
│           ├── Neck
│           │   └── Head
│           │       ├── LeftEye   (bone mắt)
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

---

## 2. Tìm bone từ GLTF model

```js
// Traverse để lấy tất cả bones và lưu vào map
function buildBoneMap(model) {
  const boneMap = {};

  model.traverse((object) => {
    if (object.isBone || object.isSkinnedMesh) {
      boneMap[object.name] = object;
    }
    // Một số model dùng Object3D thay vì Bone
    if (object.type === "Bone" || (object.isMesh && object.skeleton)) {
      boneMap[object.name] = object;
    }
  });

  return boneMap;
}

// Dùng sau khi load GLTF:
loader.load("character.glb", (gltf) => {
  const model = gltf.scene;
  const bones = buildBoneMap(model);

  // Kiểm tra bones có tồn tại không
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

## 3. Debug — In tất cả tên bones

Chạy đoạn này ngay sau khi load model để biết tên bone thực tế:

```js
function listAllBones(model) {
  console.log("=== BONE LIST ===");
  model.traverse((obj) => {
    if (obj.isBone) {
      // In cả parent chain để hiểu hierarchy
      const chain = [];
      let current = obj;
      while (current) {
        chain.unshift(current.name || "(unnamed)");
        current = current.parent;
      }
      console.log(chain.join(" > "));
    }
  });
}
```

---

## 4. Đo độ dài bones từ model (cho IK)

`arm.md` và `leg.md` cần `upperArmLength`, `lowerArmLength`, etc.
Đo **một lần khi load** từ vị trí rest:

```js
function measureBoneLengths(bones) {
  function boneLength(parentBone, childBone) {
    const parentPos = new THREE.Vector3();
    const childPos  = new THREE.Vector3();
    parentBone.getWorldPosition(parentPos);
    childBone.getWorldPosition(childPos);
    return parentPos.distanceTo(childPos);
  }

  return {
    // Arms
    leftUpperArmLength:  boneLength(bones["LeftUpperArm"],  bones["LeftLowerArm"]),
    leftLowerArmLength:  boneLength(bones["LeftLowerArm"],  bones["LeftHand"]),
    rightUpperArmLength: boneLength(bones["RightUpperArm"], bones["RightLowerArm"]),
    rightLowerArmLength: boneLength(bones["RightLowerArm"], bones["RightHand"]),

    // Legs
    leftUpperLegLength:  boneLength(bones["LeftUpperLeg"],  bones["LeftLowerLeg"]),
    leftLowerLegLength:  boneLength(bones["LeftLowerLeg"],  bones["LeftFoot"]),
    rightUpperLegLength: boneLength(bones["RightUpperLeg"], bones["RightLowerLeg"]),
    rightLowerLegLength: boneLength(bones["RightLowerLeg"], bones["RightFoot"]),

    // Spine
    hipToChest:   boneLength(bones["Hips"],   bones["UpperChest"]),
    chestToHead:  boneLength(bones["UpperChest"], bones["Head"]),
  };
}
```

---

## 5. WorldScale — Chuyển MediaPipe coords sang Three.js world

MediaPipe Pose `worldLandmarks` dùng đơn vị **meters thực tế**, gốc tọa độ tại hips.
Cần scale để khớp với kích thước nhân vật trong scene:

```js
// Tính worldScale từ kích thước thực của model
function computeWorldScale(bones, boneLengths) {
  // Chiều cao nhân vật trong model (từ hips đến đầu)
  const modelHeight = boneLengths.hipToChest + boneLengths.chestToHead;

  // Chiều rộng vai model
  const leftShoulderPos  = new THREE.Vector3();
  const rightShoulderPos = new THREE.Vector3();
  bones["LeftShoulder"].getWorldPosition(leftShoulderPos);
  bones["RightShoulder"].getWorldPosition(rightShoulderPos);
  const modelShoulderWidth = leftShoulderPos.distanceTo(rightShoulderPos);

  // MediaPipe worldLandmarks: người thực ~1.7m cao, vai ~0.45m
  const REAL_BODY_HEIGHT        = 1.65;  // meters — chiều cao từ hips đến đầu
  const REAL_SHOULDER_WIDTH     = 0.45;  // meters

  return {
    x: modelShoulderWidth / REAL_SHOULDER_WIDTH,
    y: modelHeight        / REAL_BODY_HEIGHT,
    z: modelShoulderWidth / REAL_SHOULDER_WIDTH,  // dùng x làm proxy cho depth
  };
}

// Dùng khi convert landmark:
// worldPos.x = -poseLandmark.x * worldScale.x  (mirror X)
// worldPos.y =  poseLandmark.y * worldScale.y
// worldPos.z = -poseLandmark.z * worldScale.z
```

---

## 6. Base Quaternion cho mắt

`eye_control.js` cần `baseQuaternion` là rotation gốc của eye bone trong T-pose:

```js
function captureEyeBaseQuaternions(bones) {
  // Gọi sau khi load model, trước khi bắt đầu animate
  return {
    leftEye:  bones["LeftEye"].quaternion.clone(),
    rightEye: bones["RightEye"].quaternion.clone(),
  };
}
```

---

## 7. Morph Target Map

Morph targets nằm trên `SkinnedMesh` (thường là mesh khuôn mặt):

```js
function findMorphMesh(model) {
  let morphMesh = null;
  model.traverse((obj) => {
    // Tìm mesh có nhiều morph targets nhất (thường là mesh mặt)
    if (obj.isMesh && obj.morphTargetDictionary) {
      const count = Object.keys(obj.morphTargetDictionary).length;
      if (count > 10) morphMesh = obj;  // >10 targets → đây là face mesh
    }
  });
  return morphMesh;
}

function buildMorphMap(mesh) {
  // morphTargetDictionary = { "eyeBlink_L": 0, "jawOpen": 1, ... }
  return mesh.morphTargetDictionary;
}

// Set morph target:
function setMorph(mesh, morphMap, name, value) {
  const index = morphMap[name];
  if (index !== undefined) {
    mesh.morphTargetInfluences[index] = THREE.MathUtils.clamp(value, 0, 1);
  }
}
```

---

## 8. Chuẩn bị đầy đủ khi khởi tạo character

```js
async function initCharacter(glbPath) {
  const gltf = await loadGLTF(glbPath);  // promise wrapper cho GLTFLoader
  const model = gltf.scene;

  // 1. Build bone map
  const bones = buildBoneMap(model);

  // 2. Đo bone lengths
  const boneLengths = measureBoneLengths(bones);

  // 3. Tính worldScale
  const worldScale = computeWorldScale(bones, boneLengths);

  // 4. Base quaternions
  const eyeBase = captureEyeBaseQuaternions(bones);

  // 5. Morph mesh
  const morphMesh = findMorphMesh(model);
  const morphMap  = buildMorphMap(morphMesh);

  // 6. Ghi log để debug
  console.log("✅ Bones loaded:", Object.keys(bones).length);
  console.log("📐 WorldScale:", worldScale);
  console.log("📏 BoneLengths:", boneLengths);
  console.log("😊 MorphTargets:", Object.keys(morphMap).length);

  return { model, bones, boneLengths, worldScale, eyeBase, morphMesh, morphMap };
}
```

---

## 9. Neutral Pose Calibration

Khi nhân vật bắt đầu, thu thập 30 frame đầu để tính neutral (đứng thẳng nhìn thẳng):

```js
const CALIBRATION_FRAMES = 30;
let calibrationBuffer = { shoulderHipDiff: [] };
let isCalibrated = false;

function collectCalibration(poseWorldLandmarks) {
  if (isCalibrated) return;

  const lShoulder = poseWorldLandmarks[11];
  const rShoulder = poseWorldLandmarks[12];
  const lHip      = poseWorldLandmarks[23];
  const rHip      = poseWorldLandmarks[24];

  if (!lShoulder || !rShoulder) return;

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const hipY      = (lHip.y + rHip.y) / 2;
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
| Bone không tìm thấy | Tên bone trong model khác convention | Chạy `listAllBones()` để debug |
| WorldScale sai | Model scale ≠ 1 | Gọi `model.updateWorldMatrix(true, true)` trước khi đo |
| Morph targets không có | Mesh sai | Tìm mesh có nhiều morph targets nhất |
| Eye bone quay sai | baseQuaternion capture sau khi đã animate | Capture trước frame đầu tiên |
| IK length = 0 | Bone chưa được add vào scene | Add model vào scene trước khi đo |
