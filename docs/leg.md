# Leg & Foot — Chân và bàn chân

## Object definition

```js
const Leg = {
  side: "left" | "right",

  // Bones
  upperLeg: THREE.Bone,    // Hip joint → UpperLeg (Thigh)
  lowerLeg: THREE.Bone,    // UpperLeg → LowerLeg (Shin)
  foot:     THREE.Bone,    // LowerLeg → Foot (Ankle)
  toes:     THREE.Bone,    // Foot → Toes

  // IK state
  footTarget:    THREE.Vector3,   // vị trí đích của mắt cá chân
  poleTarget:    THREE.Vector3,   // hướng đầu gối muốn cong ra (pole vector)
  footNormal:    THREE.Vector3,   // normal mặt đất tại điểm chân đứng

  // Lengths (đo từ model)
  upperLegLength: number,  // ví dụ: 0.42
  lowerLegLength: number,  // ví dụ: 0.40

  // Step state
  isGrounded:   false,
  stepPhase:    0,          // [0, 2π] trong một bước đi
  heelContact:  0,          // [0,1] gót chân chạm đất
  toeContact:   0,          // [0,1] đầu ngón chạm đất
}
```

---

## 1. Two-Bone IK — Chân (tương tự cánh tay)

Áp dụng y hệt `arm.md §1-3`, nhưng:
- Pole vector hướng **ra trước** (đầu gối cong về phía trước)
- Bone rest direction thường là `(0, -1, 0)` hoặc `(0, 1, 0)` tùy model

```js
// Pole vector mặc định khi đứng thẳng
const LEG_POLE = {
  left:  new THREE.Vector3(-0.05, 0, +0.8),  // đầu gối hơi lệch ra ngoài và ra trước
  right: new THREE.Vector3(+0.05, 0, +0.8),
};
```

### Giải IK (Law of Cosines — giống arm.md)

```js
function solveLegIK(hipPos, upperLen, lowerLen, ankleTarget) {
  const dist = THREE.MathUtils.clamp(
    hipPos.distanceTo(ankleTarget),
    Math.abs(upperLen - lowerLen) + 0.001,
    upperLen + lowerLen - 0.001,
  );

  const cosKnee = (upperLen * upperLen + lowerLen * lowerLen - dist * dist)
                / (2 * upperLen * lowerLen);
  const cosHip  = (upperLen * upperLen + dist * dist - lowerLen * lowerLen)
                / (2 * upperLen * dist);

  return {
    kneeAngle: Math.acos(THREE.MathUtils.clamp(cosKnee, -1, 1)),
    hipAngle:  Math.acos(THREE.MathUtils.clamp(cosHip,  -1, 1)),
  };
}
```

---

## 2. Joint Constraints chân

```
HIP (ball joint):
  Flex/Extend (pitch): [-2.1, +0.5]  rad   ≈ [-120°, +30°]  (đá ra trước / sau)
  Abduction   (roll):  [-0.7, +0.5]  rad   ≈ [-40°, +30°]   (dạng chân ra ngoài)
  Rotation    (yaw):   [-0.7, +0.7]  rad   ≈ ±40°            (xoay đùi)

KNEE (hinge — chỉ flex):
  Flex (pitch):        [-2.6, 0.0]   rad   ≈ [-150°, 0°]
  Roll, Yaw:           KHÓA = 0

ANKLE:
  Dorsi/Plantar (pitch): [-0.52, +0.70] rad  ≈ [-30°, +40°]  (gập / duỗi cổ chân)
  Inversion     (roll):  [-0.35, +0.52] rad  ≈ [-20°, +30°]  (nghiêng bàn chân)
  Rotation      (yaw):   [-0.26, +0.26] rad  ≈ ±15°

TOES:
  Flex (pitch):          [-0.35, +0.70] rad  ≈ [-20°, +40°]
```

---

## 3. Foot IK — Bàn chân tiếp xúc mặt đất

Khi chân chạm đất, bàn chân phải căn chỉnh theo **normal của mặt đất** (không bao giờ xuyên qua sàn).

### 3a. Foot alignment với mặt đất

```js
function alignFootToGround(foot, groundNormal, ankleTarget) {
  // Mặt phẳng bàn chân phải song song với mặt đất
  // groundNormal: vector vuông góc mặt đất (thường = [0,1,0] với sàn phẳng)

  const footUp    = new THREE.Vector3(0, 1, 0);  // hướng "trên" của bàn chân lúc rest
  const footForward = new THREE.Vector3(0, 0, 1); // hướng mũi chân

  // Tính rotation để footUp hướng về groundNormal
  const footRotation = new THREE.Quaternion().setFromUnitVectors(footUp, groundNormal);
  foot.quaternion.copy(footRotation);

  // Thêm ankle pitch (dorsiflexion) theo terrain slope
  const slopeAngle = Math.acos(groundNormal.dot(new THREE.Vector3(0, 1, 0)));
  foot.rotation.x += slopeAngle * 0.7;  // 70% để bù độ dốc
}
```

### 3b. Heel-to-Toe roll khi bước

```js
// Trong một bước đi, chân tiếp đất gót trước → mũi sau:
// stepContact: [0 = chân nhấc lên, 0.3 = gót chạm, 0.7 = cả bàn, 1.0 = mũi đẩy]

function computeAnklePitch(stepContact) {
  if (stepContact < 0.3) {
    // Chân trên không — ankle neutral
    return THREE.MathUtils.lerp(0, -0.3, stepContact / 0.3);  // chuẩn bị gót đáp
  } else if (stepContact < 0.7) {
    // Gót đến cả bàn: ankle từ flexion → neutral
    return THREE.MathUtils.lerp(-0.3, 0, (stepContact - 0.3) / 0.4);
  } else {
    // Mũi chân đẩy — plantarflexion (nhón lên)
    return THREE.MathUtils.lerp(0, 0.5, (stepContact - 0.7) / 0.3);
  }
}
```

---

## 4. Step Cycle — Chu kỳ bước đi

### 4a. Phase của mỗi chân

```js
// Hai chân lệch pha nhau 0.5 chu kỳ (π rad)
const LEFT_LEG_PHASE_OFFSET  = 0;
const RIGHT_LEG_PHASE_OFFSET = Math.PI;

// stepPhase tăng theo tốc độ di chuyển
const WALK_SPEED  = 1.0;  // bước/giây khi đi bộ
const RUN_SPEED   = 2.8;

function updateStepPhase(leg, walkSpeed, dt) {
  leg.stepPhase += 2 * Math.PI * walkSpeed * dt;
  if (leg.stepPhase > 2 * Math.PI) leg.stepPhase -= 2 * Math.PI;
}
```

### 4b. Foot target theo stepPhase

```js
function computeFootTarget(leg, hipWorldPos, stepPhase, stepLength, stepHeight) {
  // stepPhase: 0=chân đứng, π=chân giữa không, 2π=chân đứng lại
  const t = stepPhase / (2 * Math.PI);  // [0, 1]

  // Vị trí đặt chân (nơi chân sẽ chạm đất)
  const footPlantPos = hipWorldPos.clone().add(
    new THREE.Vector3(leg.side === "left" ? -0.12 : 0.12, -1.0, 0)
  );

  // Arc trajectory: chân nhấc lên giữa bước
  const liftHeight = Math.max(0, Math.sin(t * Math.PI)) * stepHeight;

  // Forward swing: chân di chuyển về phía trước khi nhấc
  const forwardOffset = Math.sin(t * Math.PI) * stepLength * 0.5;

  return new THREE.Vector3(
    footPlantPos.x,
    footPlantPos.y + liftHeight,
    footPlantPos.z + forwardOffset,
  );
}
```

---

## 5. Ground Raycast — Phát hiện mặt đất

Để chân luôn tiếp xúc đúng mặt đất (không nổi hoặc chui xuống):

```js
function snapFootToGround(footTarget, scene, raycaster) {
  // Bắn ray từ trên xuống tại vị trí đặt chân
  raycaster.set(
    new THREE.Vector3(footTarget.x, footTarget.y + 1.0, footTarget.z),  // origin cao hơn chân 1 unit
    new THREE.Vector3(0, -1, 0),  // hướng xuống
  );

  const intersects = raycaster.intersectObjects(scene.children, true);

  if (intersects.length > 0) {
    const hit = intersects[0];
    footTarget.y = hit.point.y;           // snapping chân về mặt đất
    return hit.face.normal.clone();       // normal mặt đất
  }

  return new THREE.Vector3(0, 1, 0);     // fallback: sàn phẳng
}
```

---

## 6. Hip Sway và Tilt khi đi

Khi đi, hông lắc lư:

```js
// stepPhase của chân trái
const HIP_SWAY_AMP  = 0.04;  // rad — lắc ngang
const HIP_TILT_AMP  = 0.025; // rad — nghiêng theo bước

function computeHipMotion(leftStepPhase, walkSpeed) {
  const intensityFactor = THREE.MathUtils.clamp(walkSpeed / WALK_SPEED, 0, 1);

  return {
    // Sway: hông nghiêng về bên chân đang đứng
    roll:  Math.sin(leftStepPhase)     × HIP_SWAY_AMP  × intensityFactor,
    // Tilt: hông nghiêng nhẹ về phía trước theo nhịp
    pitch: Math.cos(leftStepPhase * 2) × HIP_TILT_AMP  × intensityFactor,
    // Forward offset: hông di chuyển nhẹ theo bước
    yaw:   Math.sin(leftStepPhase)     × 0.02           × intensityFactor,
  };
}
```

---

## 7. Knee Pop Prevention

Khi chân gần duỗi thẳng hoàn toàn (gần `maxReach`), đầu gối có thể "lật" (hyperextend). Ngăn ngừa:

```js
const KNEE_SAFETY_MARGIN = 0.05;  // giữ khoảng cách 5% trước khi duỗi thẳng tối đa

function safeKneeAngle(kneeAngle) {
  const MIN_KNEE_BEND = 0.08;  // luôn giữ đầu gối cong tối thiểu ~5°
  return Math.max(kneeAngle, MIN_KNEE_BEND);
}
```

---

## 8. Procedural Idle — Đứng yên tự nhiên

Khi không có body tracking, chân có micro-movement:

```js
const IDLE_WEIGHT_SHIFT_FREQ = 0.06;   // Hz — đổi chân chịu trọng lực ~17s/lần
const IDLE_WEIGHT_SHIFT_AMP  = 0.018;  // rad

const t = performance.now() / 1000;
const weightShift = Math.sin(t × 2 × Math.PI × IDLE_WEIGHT_SHIFT_FREQ);

// Khi hông nghiêng phải → chân phải chịu trọng lực
hips.rotation.z += weightShift × IDLE_WEIGHT_SHIFT_AMP;

// Chân chịu trọng lực: foot target xuống thấp hơn chút
leftFootTarget.y  -= Math.max(0,  weightShift) × 0.005;
rightFootTarget.y -= Math.max(0, -weightShift) × 0.005;
```

---

## 9. Lấy IK target từ MediaPipe Pose

```js
// Pose landmarks: 27=L_Ankle, 28=R_Ankle, 29=L_Heel, 30=R_Heel
function getLegIKTargetsFromPose(poseLandmarks, worldScale) {
  const lAnkle = poseLandmarks[27];
  const rAnkle = poseLandmarks[28];

  return {
    left: new THREE.Vector3(
      -(lAnkle.x - 0.5) × worldScale.x,
       (0.5 - lAnkle.y) × worldScale.y,
      -lAnkle.z          × worldScale.z,
    ),
    right: new THREE.Vector3(
      -(rAnkle.x - 0.5) × worldScale.x,
       (0.5 - rAnkle.y) × worldScale.y,
      -rAnkle.z          × worldScale.z,
    ),
  };
}
```

---

## 10. Thứ tự tính toán mỗi frame

```
1. updateStepPhase(leg, speed, dt)            → cập nhật phase
2. computeFootTarget(leg, hipPos, phase, ...)  → vị trí đặt chân
3. snapFootToGround(target, scene, raycaster)  → snap về mặt đất
4. solveLegIK(hipPos, upper, lower, target)    → giải góc
5. computeKneePlane(hip, target, pole)         → mặt phẳng đầu gối
6. applyLegIK(bones, angles)                   → set bone rotation
7. safeKneeAngle(kneeAngle)                    → tránh hyperextend
8. alignFootToGround(foot, groundNormal)       → căn bàn chân
9. computeAnklePitch(stepContact)              → heel-to-toe roll
10. computeHipMotion(stepPhase)               → hip sway/tilt
```

---

## Lưu ý quan trọng khi code

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Đầu gối lật (hyperextend) | Thiếu `MIN_KNEE_BEND` | Luôn clamp `kneeAngle >= 0.08` |
| Chân nổi khỏi đất | Thiếu ground snapping | Dùng Raycaster mỗi frame |
| Bàn chân xuyên sàn | Ankle target quá thấp | Clamp `footTarget.y >= groundY + heelHeight` |
| Đầu gối hướng vào trong | Pole vector sai | Pole phải ra phía trước và hơi ra ngoài |
| Hip lắc quá mạnh | `HIP_SWAY_AMP` quá lớn | Nhân thêm `intensityFactor` theo tốc độ |
| Chân trượt (foot sliding) | Không lock foot khi grounded | Khi `isGrounded = true`, fix foot target, không update theo hip |
