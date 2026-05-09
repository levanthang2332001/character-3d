---
name: procedural-gestures
description: Pattern thêm gesture procedural đè lên Mixer pose — base quaternion offset, smoothstep ease, timeline 3-phase (raise / hold / return), keyboard trigger. Reference đang chạy là playRightHandHello() trong script/animation/arm.js. Use this when the user asks "thêm gesture vẫy tay", "tay chỉ trỏ", "nắm tay", "gesture không chồng lên animation", "gesture bị nháy / accumulate".
---

# Procedural Gestures — Đè motion lên Animation Mixer

## Khi dùng skill này

Thêm cử chỉ scripted (vẫy tay, point, nắm đấm, gật đầu nhấn mạnh…) trên một nhân vật **đã có Mixer chạy** (idle/walk/run). Không thay đổi clip — chỉ cộng offset rotation trong frame.

Reference đang chạy: `script/animation/arm.js` — `playRightHandHello()` bind phím `H`.

## Vấn đề: tại sao không set rotation thẳng?

```js
bone.rotation.y = waveAmount;       // ❌ Mixer ghi đè ngay frame sau khi mixer.update(dt) chạy lại
```

Mixer ghi pose mới mỗi frame. Set rotation trực tiếp → nháy / không có hiệu lực.

## Pattern: snapshot base quaternion + multiply offset

```js
// Sau khi mixer.update(dt) đã chạy → snapshot pose hiện tại làm BASE
BASE_UPPER_ARM_Q.copy(upperArm.quaternion);
BASE_LOWER_ARM_Q.copy(lowerArm.quaternion);
BASE_HAND_Q.copy(hand.quaternion);

// Reset về base, rồi multiply offset
upperArm.quaternion.copy(BASE_UPPER_ARM_Q);
applyQuaternionOffset(upperArm, AXIS_Z, lift * weight);
applyQuaternionOffset(upperArm, AXIS_X, forward * weight);

lowerArm.quaternion.copy(BASE_LOWER_ARM_Q);
applyQuaternionOffset(lowerArm, AXIS_X, elbowBend * weight);

function applyQuaternionOffset(bone, axis, angle) {
  TEMP_Q.setFromAxisAngle(axis, angle);
  bone.quaternion.multiply(TEMP_Q);
}
```

Quan trọng: **gọi gesture update SAU `mixer.update(dt)`** trong render loop:

```js
mixer.update(dt);
updateArmGestures(dt);                                  // gesture đè lên pose mixer
renderer.render(scene, camera);
```

## Pattern: timeline 3 phase với ease

Wave hand chia 3 đoạn theo phần trăm thời gian `t` (0..1):

```js
const CFG = {
  duration:    1.8,                                     // tổng giây
  raiseEnd:    0.5,                                     // 0..0.5: đưa tay lên
  waveEnd:     0.3,                                     // *(see lưu ý dưới)*
  raiseWeight: 1.0,
  waveWeight:  0.6,
  upperArmLift:    -2.0,
  upperArmForward: -0.2,
  elbowBend:       -0.8,
  waveSpeed:        14,
  waveAmount:       0.3,
};

let raiseW = 0, waveW = 0, returnW = 0;

if (t < CFG.raiseEnd) {                                 // Phase 1: nâng tay (ease in/out)
  raiseW = easeInOut01(t / CFG.raiseEnd);
} else if (t < CFG.waveEnd) {                           // Phase 2: giữ + lắc
  raiseW = CFG.raiseWeight;
  waveW  = CFG.waveWeight;
} else {                                                // Phase 3: hạ tay
  raiseW  = CFG.raiseWeight;
  returnW = easeInOut01((t - CFG.waveEnd) / (1 - CFG.waveEnd));
}

const finalWeight = raiseW * (1 - returnW);             // tắt dần khi return
```

> ⚠️ Bug có thật trong `arm.js` hiện tại: `waveEnd: 0.3` nhỏ hơn `raiseEnd: 0.5` → phase 2 không bao giờ chạy. Nếu gesture không "lắc" được, đặt `waveEnd > raiseEnd`, ví dụ `0.85`.

### easeInOut01 — smoothstep

```js
function easeInOut01(x) {
  x = THREE.MathUtils.clamp(x, 0, 1);
  return x * x * (3 - 2 * x);                           // 3x² - 2x³
}
```

Đầu và cuối có đạo hàm = 0 → khởi động + dừng nhẹ nhàng (không giật).

## Pattern: oscillation cho lắc tay / gật đầu nhấn

```js
if (waveW > 0) {
  const wave = Math.sin(time * CFG.waveSpeed) * CFG.waveAmount * finalWeight;
  applyQuaternionOffset(hand, AXIS_Y, wave);
}
```

`waveSpeed = 14` rad/s ≈ 2.2 Hz — đủ nhanh trông sống động.

## Pattern: bone fallback đa naming

Mixamo / VRM / generic dùng tên khác nhau → resolve một lần, cache:

```js
function getFirstExistingBone(bones, names) {
  for (const n of names) if (bones[n]) return bones[n];
  return null;
}
const upperArm = getFirstExistingBone(bones, [
  "RightUpperArm", "RightArm",
  "mixamorigRightArm", "mixamorig:RightArm",
]);
```

## Pattern: state machine

```js
const gestureState = {
  bones: null,                                          // cache sau initArmGestureSystem
  active: false,
  time: 0,
  duration: 1.8,
};

export function playRightHandHello() {
  gestureState.active = true;
  gestureState.time   = 0;
  gestureState.duration = CFG.duration;
}

export function updateArmGestures(dt) {
  if (!gestureState.active) return;
  gestureState.time += dt;
  const t = gestureState.time / gestureState.duration;
  if (t >= 1) { gestureState.active = false; return; }
  // ... apply 3-phase logic
}
```

## Trigger keyboard

```js
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH") playRightHandHello();
});
```

GUI trigger trong `character.js`:

```js
folderActivation.add(s, "wave right hand (H)");          // s["wave right hand (H)"] = playRightHandHello
```

## Khi cần gesture mới — checklist

1. Tạo `CONFIG_<NAME>` với `duration`, các phase boundary, weight, axis offset, speed.
2. State riêng (`gestureState_<name>`) hoặc share state nếu chỉ 1 gesture chạy 1 lúc.
3. Resolve bones với fallback naming.
4. Snapshot base quaternion → reset → apply offset (multiply, không add).
5. Timeline phase + ease + finalWeight = raiseW × (1 - returnW).
6. Gọi update trong render loop SAU `mixer.update(dt)`.
7. Trigger: keyboard hoặc GUI button.

## Common pitfalls

| Triệu chứng | Fix |
|-------------|-----|
| Gesture không thấy | Quên gọi `updateArmGestures(dt)` sau mixer |
| Tay nháy giật | Dùng `bone.rotation.x = ...` thay vì quaternion multiply trên base snapshot |
| Tay drift sau lần thứ 2 | Quên `quaternion.copy(BASE)` reset trước multiply |
| Phase 2 không chạy | `waveEnd < raiseEnd` (bug `arm.js` hiện tại — kiểm tra giá trị) |
| Lắc quá nhanh / chậm | Tweak `waveSpeed` (14 = tự nhiên cho vẫy tay) |
| Gesture bắt đầu từ T-pose | Quên snapshot trước khi apply (mixer chưa kịp update) |

## Reference

- Code: `script/animation/arm.js` — `playRightHandHello()`.
- GUI hookup: `script/animation/character.js` `bindWeightSliders` + `folderActivation.add(s, "wave right hand (H)")`.
- Lý thuyết quaternion: `docs/00-overview/glossary.md` §12.
