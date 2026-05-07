# Head & Neck — Chuyển động đầu và cổ

## Object definition

```js
const HeadNeck = {
  // Bones
  neck:  THREE.Bone,   // parent = Spine2 (UpperChest)
  head:  THREE.Bone,   // parent = Neck

  // State
  currentEuler:   { pitch: 0, yaw: 0, roll: 0 },
  targetEuler:    { pitch: 0, yaw: 0, roll: 0 },
  velocity:       { pitch: 0, yaw: 0, roll: 0 },  // spring velocity

  // Neutral calibration
  neckNeutral:    { pitch: 0, yaw: 0 },
}
```

---

## 1. Head Rotation (đã implement trong face_tracking_utils.js)

Xem `face_mesh.md` để biết chi tiết. Tóm tắt:

```
rawYaw   = (nose.x  - eyeCenter.x) / (eyeDistance × 0.8)
rawPitch = -(nose.y - eyeCenter.y) / (eyeDistance × 2.5)
rawRoll  = atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) × 0.5
```

---

## 2. Phân phối rotation giữa Neck và Head

Người thật không chỉ xoay đầu — cổ cũng tham gia.
Chia đều để trông tự nhiên hơn là dồn toàn bộ vào một bone:

```
HEAD  nhận 60–70% rotation
NECK  nhận 30–40% rotation
```

```js
const HEAD_RATIO = 0.65;
const NECK_RATIO = 0.35;

// Áp dụng
neck.rotation.set(
  pitch × NECK_RATIO,
  yaw   × NECK_RATIO,
  roll  × NECK_RATIO,
);
head.rotation.set(
  pitch × HEAD_RATIO,
  yaw   × HEAD_RATIO,
  roll  × HEAD_RATIO,
);
```

---

## 3. Joint Constraints (giới hạn khớp)

```
HEAD:
  pitch  (gật / ngẩng)  :  [-0.55 rad, +0.45 rad]   ≈ [-32°, +26°]
  yaw    (quay ngang)   :  [-0.70 rad, +0.70 rad]    ≈ ±40°
  roll   (nghiêng)      :  [-0.30 rad, +0.30 rad]    ≈ ±17°

NECK:
  pitch                 :  [-0.35 rad, +0.25 rad]
  yaw                   :  [-0.45 rad, +0.45 rad]
  roll                  :  [-0.20 rad, +0.20 rad]
```

```js
function clampHeadRotation(euler) {
  return {
    pitch: THREE.MathUtils.clamp(euler.pitch, -0.55, 0.45),
    yaw:   THREE.MathUtils.clamp(euler.yaw,   -0.70, 0.70),
    roll:  THREE.MathUtils.clamp(euler.roll,  -0.30, 0.30),
  };
}
```

---

## 4. Follow-through (quán tính đầu)

Khi đầu quay, cổ có xu hướng **trễ nhẹ** so với đầu (follow-through).
Dùng Spring Damper thay vì lerp đơn thuần:

```js
const NECK_STIFFNESS = 18;  // độ cứng lò xo
const NECK_DAMPING   = 6;   // hệ số giảm chấn (cao = dừng nhanh, không dao động)

function updateNeckSpring(state, targetYaw, targetPitch, dt) {
  // Trục yaw
  const forceYaw    = -NECK_STIFFNESS × (state.yaw - targetYaw)
                      - NECK_DAMPING × state.velocityYaw;
  state.velocityYaw += forceYaw × dt;
  state.yaw         += state.velocityYaw × dt;

  // Trục pitch
  const forcePitch    = -NECK_STIFFNESS × (state.pitch - targetPitch)
                        - NECK_DAMPING × state.velocityPitch;
  state.velocityPitch += forcePitch × dt;
  state.pitch         += state.velocityPitch × dt;
}
```

**Critical Note:**
> `dt` = delta time tính bằng giây (thường 0.016s ở 60fps).
> KHÔNG dùng milliseconds — spring sẽ bị unstable.

---

## 5. Secondary Motion — Head Bob khi thở

Đầu nhấp nhẹ lên xuống theo nhịp thở (0.2–0.3 Hz):

```js
const BREATH_FREQ      = 0.25;   // Hz — chu kỳ thở ~4 giây
const HEAD_BREATH_AMP  = 0.008;  // radian — rất nhỏ, chỉ gợi ý

// Trong render loop
const breathPhase = performance.now() / 1000 × (2 × Math.PI × BREATH_FREQ);
const headBreathOffset = Math.sin(breathPhase) × HEAD_BREATH_AMP;

head.rotation.x += headBreathOffset;  // pitch nhẹ theo nhịp thở
```

---

## 6. Eye Contact Bias

Khi nhân vật "nhìn" vào camera (interaction mode), đầu hướng về phía đích nhìn.
Blending giữa tracking và look-at target:

```js
// Target nhìn (ví dụ: vị trí user / camera)
const lookTarget = new THREE.Vector3(0, eyeHeight, viewDistance);

// Tính look-at rotation
const headWorldPos = head.getWorldPosition(new THREE.Vector3());
const lookDir      = lookTarget.clone().sub(headWorldPos).normalize();

// Chuyển sang local euler
const lookYaw   = Math.atan2(lookDir.x, lookDir.z);
const lookPitch = -Math.asin(lookDir.y);

// Blend: 0 = tracking thô, 1 = luôn nhìn thẳng camera
const LOOK_AT_BLEND = 0.4;
finalYaw   = THREE.MathUtils.lerp(trackedYaw,   lookYaw,   LOOK_AT_BLEND);
finalPitch = THREE.MathUtils.lerp(trackedPitch, lookPitch, LOOK_AT_BLEND);
```

---

## 7. Idle Animation — Random micro-movement

Khi không có tracking input, đầu có micro-movement ngẫu nhiên để tránh trông "đứng hình":

```js
// Noise-based idle (dùng Perlin noise hoặc simplex noise)
// Nếu không có noise lib, dùng sin ghép tần số khác nhau:

const t = performance.now() / 1000;
const idleYaw   = Math.sin(t × 0.3) × 0.012 + Math.sin(t × 0.7) × 0.006;
const idlePitch = Math.sin(t × 0.2) × 0.008 + Math.sin(t × 0.5) × 0.004;
const idleRoll  = Math.sin(t × 0.15) × 0.005;

// Cộng vào final rotation trước khi set bone
finalYaw   += idleYaw;
finalPitch += idlePitch;
finalRoll  += idleRoll;
```

---

## 8. State machine cho Head

```
IDLE     → Chạy idle animation + micro-movement
TRACKED  → Nhận input từ face tracking (face_mesh.js)
LOOK_AT  → Hướng về look-at target (NPC interaction)
ANIMATED → Chạy keyframe animation (cinematic)
```

Transition rule:
```js
if (isFaceTracking)   state = "TRACKED";
else if (hasLookAt)   state = "LOOK_AT";
else                  state = "IDLE";
```

---

## Code Integration Note

```js
// Trong render loop (facecap.js hoặc character controller)
function updateHeadNeck(dt) {
  const trackedEuler = getFaceTrackingEuler(); // từ face_mesh.js

  // 1. Clamp
  const clamped = clampHeadRotation(trackedEuler);

  // 2. Spring update cho neck
  updateNeckSpring(neckState, clamped.yaw, clamped.pitch, dt);

  // 3. Thêm idle + breath
  const finalHead = addIdleMotion(clamped);

  // 4. Phân phối vào bones
  neck.rotation.set(neckState.pitch, neckState.yaw, clamped.roll × NECK_RATIO);
  head.rotation.set(finalHead.pitch × HEAD_RATIO, finalHead.yaw × HEAD_RATIO, finalHead.roll);
}
```

---

## Lưu ý quan trọng khi code

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Đầu rung (jitter) | lerp factor quá cao hoặc input thô | Dùng spring damper, tăng damping |
| Đầu lệch sang một bên | Thiếu neutral calibration | Thu 10–15 frame đầu tính neutral offset |
| Cổ không chuyển động | Quên áp rotation vào neck bone | Nhớ set cả `neck.rotation` |
| Gimbal lock khi roll + yaw lớn | Dùng Euler order sai | Dùng `"YXZ"` cho head (yaw trước, pitch sau) |
| Xoay ngược hướng | Camera selfie mirror | Negate yaw: `finalYaw = -rawYaw` |
