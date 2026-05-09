# Spine — Cột sống

> S-curve lean phân phối lên 4 bone, breathing 0.25Hz (ngực + bụng + vai), spine twist counter-rotate khi đầu quay, idle sway, height bob khi đi.

**When to read**: Phase 2 — viết `spine_controller.js`. Hoặc cần thêm/sửa breathing, idle motion.

---

## Object definition

```js
const Spine = {
  // Bone chain (từ gốc lên đỉnh)
  bones: [
    { name: "Hips",       ref: THREE.Bone },   // [0] gốc toàn bộ cơ thể
    { name: "Spine0",     ref: THREE.Bone },   // [1] thắt lưng dưới
    { name: "Spine1",     ref: THREE.Bone },   // [2] lưng giữa
    { name: "Spine2",     ref: THREE.Bone },   // [3] ngực trên (UpperChest)
  ],

  // State
  leanTarget:    { pitch: 0, yaw: 0, roll: 0 },
  leanCurrent:   { pitch: 0, yaw: 0, roll: 0 },
  breathPhase:   0,      // radian, tăng mỗi frame
  swayPhase:     0,      // micro sway cho idle

  // Twist: khi đầu quay, lưng xoắn nhẹ theo
  twistCurrent:  0,
}
```

---

## 1. Phân phối Lean trên chain xương

Khi nhân vật nghiêng người (lean), rotation **KHÔNG được dồn vào một bone** —
phải chia đều theo trọng số để đường cong lưng trông tự nhiên (S-curve):

```
Hips    nhận 20% lean
Spine0  nhận 25% lean
Spine1  nhận 30% lean
Spine2  nhận 25% lean
```

```js
const SPINE_WEIGHTS = [0.20, 0.25, 0.30, 0.25];  // tổng = 1.0

function applySpineLean(bones, leanPitch, leanYaw, leanRoll) {
  bones.forEach((bone, i) => {
    bone.ref.rotation.x = leanPitch × SPINE_WEIGHTS[i];
    bone.ref.rotation.y = leanYaw   × SPINE_WEIGHTS[i];
    bone.ref.rotation.z = leanRoll  × SPINE_WEIGHTS[i];
  });
}
```

---

## 2. Joint Constraints cột sống

```
HIPS    pitch: [-0.40, +0.35]   yaw: [-0.30, +0.30]   roll: [-0.20, +0.20]
Spine0  pitch: [-0.25, +0.20]   yaw: [-0.20, +0.20]   roll: [-0.15, +0.15]
Spine1  pitch: [-0.30, +0.25]   yaw: [-0.25, +0.25]   roll: [-0.20, +0.20]
Spine2  pitch: [-0.35, +0.30]   yaw: [-0.30, +0.30]   roll: [-0.20, +0.20]
```

---

## 3. Breathing Animation

Hô hấp tạo 3 loại chuyển động đồng thời:

### 3a. Ribcage expand (Spine2 pitch)
```js
const BREATH_FREQ      = 0.25;    // Hz (~4s / chu kỳ, khi nghỉ ngơi)
const BREATH_CHEST_AMP = 0.025;   // rad — ngực mở ra khi hít vào

const breathCycle = Math.sin(breathPhase);  // [-1, 1]
// Hít vào: breathCycle > 0 → ngực mở (pitch âm = ngả ra sau)
spine2.rotation.x += breathCycle × BREATH_CHEST_AMP × (-1);
```

### 3b. Shoulder lift (ảnh hưởng Spine2)
```js
const BREATH_SHOULDER_LIFT = 0.008;  // rất nhỏ, chỉ gợi ý
// Vai nâng lên khi hít vào
shoulderOffset.y = Math.max(0, breathCycle) × BREATH_SHOULDER_LIFT;
```

### 3c. Belly expand (Spine0 / Hips)
```js
const BREATH_BELLY_AMP = 0.012;   // bụng phình ra
// Dùng phase trễ hơn ngực 0.3 rad (bụng phình trước ngực một chút)
const bellyPhase = breathPhase - 0.3;
spine0.rotation.x += Math.sin(bellyPhase) × BREATH_BELLY_AMP × (-1);
```

### Update breathPhase mỗi frame
```js
function updateBreath(dt) {
  breathPhase += 2 × Math.PI × BREATH_FREQ × dt;
  if (breathPhase > 2 × Math.PI) breathPhase -= 2 × Math.PI;  // wrap
}
```

---

## 4. Spine Twist khi đầu quay (Counter-rotation)

Người thật: khi đầu quay, vai và lưng trên xoắn nhẹ theo cùng chiều.
Nhưng hông có xu hướng xoay **ngược chiều** một chút để cân bằng:

```
headYaw = +0.5 rad (quay phải)
  → Spine2 twist = +0.5 × 0.20 = +0.10 rad
  → Spine1 twist = +0.5 × 0.12 = +0.06 rad
  → Spine0 twist = +0.5 × 0.05 = +0.025 rad
  → Hips   twist = +0.5 × (-0.08) = -0.04 rad  ← counter-rotate nhẹ
```

```js
const SPINE_TWIST_RATIOS = {
  hips:   -0.08,
  spine0:  0.05,
  spine1:  0.12,
  spine2:  0.20,
};

function applySpineTwist(bones, headYaw) {
  // Lerp để twist đi theo đầu mượt hơn
  twistCurrent = THREE.MathUtils.lerp(twistCurrent, headYaw, 0.06);

  bones.hips.rotation.y   += twistCurrent × SPINE_TWIST_RATIOS.hips;
  bones.spine0.rotation.y += twistCurrent × SPINE_TWIST_RATIOS.spine0;
  bones.spine1.rotation.y += twistCurrent × SPINE_TWIST_RATIOS.spine1;
  bones.spine2.rotation.y += twistCurrent × SPINE_TWIST_RATIOS.spine2;
}
```

---

## 5. Idle Sway (đung đưa khi đứng yên)

Người đứng yên không bất động — có micro-sway theo nhịp sinh học:

```js
const SWAY_FREQ_X = 0.11;   // Hz — lắc lư trước sau
const SWAY_FREQ_Z = 0.08;   // Hz — lắc lư ngang
const SWAY_AMP    = 0.006;  // radian — rất nhỏ

const t = performance.now() / 1000;
const swayX = Math.sin(t × 2π × SWAY_FREQ_X) × SWAY_AMP;
const swayZ = Math.sin(t × 2π × SWAY_FREQ_Z + 1.2) × SWAY_AMP;  // phase offset

// Áp vào hips để cả thân lắc
hips.rotation.x += swayX;
hips.rotation.z += swayZ;
```

---

## 6. Lean từ MediaPipe Pose

Nếu có body tracking, lấy lean từ shoulder và hip landmarks:

```js
// Pose landmarks: 11=L_Shoulder, 12=R_Shoulder, 23=L_Hip, 24=R_Hip
function computeSpineLeanFromPose(poseLandmarks) {
  const lShoulder = poseLandmarks[11];
  const rShoulder = poseLandmarks[12];
  const lHip      = poseLandmarks[23];
  const rHip      = poseLandmarks[24];

  const shoulderCenter = midpoint(lShoulder, rShoulder);
  const hipCenter      = midpoint(lHip, rHip);

  // Lean forward/back: shoulder so với hip (trục Y)
  // SPINE_NEUTRAL_PITCH: offset hiệu chỉnh khi đứng thẳng.
  // Cách lấy: thu trung bình (shoulderCenter.y - hipCenter.y) trong 30 frame đầu khi nhân vật đứng thẳng.
  // Giá trị mặc định nếu chưa calibrate: 0.3 (tương đương khoảng cách bình thường trên Pose normalized)
  const SPINE_NEUTRAL_PITCH = state.neutralShoulderHipDiff ?? 0.30;
  const rawPitch = (shoulderCenter.y - hipCenter.y - SPINE_NEUTRAL_PITCH) / 0.3;

  // Lean side: shoulder so với hip (trục X)
  const rawRoll  = (shoulderCenter.x - hipCenter.x) / 0.15;

  return {
    pitch: THREE.MathUtils.clamp(-rawPitch × 0.6, -0.4, 0.35),
    roll:  THREE.MathUtils.clamp(-rawRoll  × 0.5, -0.2, 0.20),
  };
}
```

---

## 7. Height Bobbing khi di chuyển

Khi nhân vật bước đi, cả thân nhún nhẹ theo chu kỳ bước chân:

```js
// stepPhase: 0→2π trong một chu kỳ bước (từ leg.js)
const BOB_AMPLITUDE = 0.015;  // units (world space)
const BOB_LATERAL   = 0.008;  // lắc ngang

// Thân nhún xuống 2 lần / bước (mỗi khi chân chạm đất)
const verticalBob  = -Math.abs(Math.sin(stepPhase)) × BOB_AMPLITUDE;
const lateralTilt  =  Math.sin(stepPhase) × BOB_LATERAL;

hips.position.y  += verticalBob;
hips.rotation.z  += lateralTilt;   // nghiêng theo bước
spine2.rotation.z -= lateralTilt × 0.5;  // counter-lean ngực ngược lại
```

---

## 8. Thứ tự tính toán mỗi frame

```
1. updateBreath(dt)              → tính breathPhase mới
2. computeLean(input)            → lấy lean target (từ pose hoặc procedural)
3. lerpLean(target, current)     → làm mượt lean
4. applySpineLean(bones, lean)   → phân phối lên chain
5. applySpineTwist(bones, headYaw)  → twist theo đầu
6. applyBreathOffset(bones, breathPhase)
7. applyIdleSway(hips, t)
8. applyHeightBob(hips, stepPhase)  ← chỉ khi đang đi
```

---

## Lưu ý quan trọng khi code

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Lưng gập gãy | Dồn rotation vào 1 bone | Dùng `SPINE_WEIGHTS` phân phối |
| Thân nghiêng quá nhiều | Thiếu clamp trên lean | Clamp lean vào `[-0.4, 0.35]` |
| Thở trông giả tạo | Chỉ animate ngực | Kết hợp cả belly + chest + shoulder |
| Counter-rotate quên | Chỉ twist cùng chiều | Hips cần twist ngược: `× (-0.08)` |
| Rotation accumulate | Cộng dồn mỗi frame | Set absolute rotation, không dùng `+=` với static pose |

---

← Prev: [head-neck.md](head-neck.md) | **Up**: [README](../README.md) | Next: [arm.md →](arm.md)
