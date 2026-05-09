---
name: body-controllers
description: Update functions cho từng bộ phận cơ thể trong HoloLab — spine lean/twist/breathe, head-neck spring damper, two-bone IK cho cánh tay và chân, finger curl/spread, foot ground contact. Use this when the user asks về spine S-curve, neck follow-through, arm IK pole vector, knee hyperextend, foot snap to ground, finger lag, hoặc khi build/sửa controller cho một bộ phận cụ thể.
---

# Body Part Controllers — Update functions

## Khi dùng skill này

Đụng tới spine / head-neck / arm / hand / leg controller — viết code update bone rotation từ tracking input.

## Update order chuẩn (từ gốc → ngọn, mỗi frame)

```
1. updateSpine(dt)        Hips, Spine, Chest, UpperChest
2. updateHeadNeck(dt)     Neck (35%), Head (65%)
3. updateEyes(dt)         LeftEye, RightEye (base quaternion + offset)
4. updateMorphTargets()   blendshape mặt (52 morph)
5. updateArm(left, dt)    LeftUpperArm/LowerArm/Hand (IK)
6. updateArm(right, dt)
7. updateHand(left, dt)   fingers (curl + spread)
8. updateHand(right, dt)
9. updateLeg(left, dt)    LeftUpperLeg/LowerLeg/Foot (IK + ground)
10. updateLeg(right, dt)
11. applyBreathing()      cộng vào cuối — không override
```

Chi tiết từng cái — tóm gọn ý chính, code đầy đủ ở `docs/03-body-parts/`.

---

## Spine

**Pattern S-curve**: phân phối lean lên chain xương, không dồn 1 bone.

```js
const SPINE_WEIGHTS = [0.20, 0.25, 0.30, 0.25];         // Hips, Spine, Chest, UpperChest
const keys = ["Hips", "Spine", "Chest", "UpperChest"];

keys.forEach((name, i) => {
  bones[name].rotation.x = lean.pitch * SPINE_WEIGHTS[i];
  bones[name].rotation.z = lean.roll  * SPINE_WEIGHTS[i];
});
```

**Twist khi đầu quay** — Hips counter-rotate nhẹ:

```js
const TWIST = { hips: -0.08, spine0: 0.05, spine1: 0.12, spine2: 0.20 };
```

**Breathing** — 0.25 Hz, kết hợp ngực + bụng + vai:

```js
breathPhase += 2 * Math.PI * 0.25 * dt;
spine2.rotation.x += -Math.sin(breathPhase) * 0.025;    // ngực mở khi hít
spine0.rotation.x += -Math.sin(breathPhase - 0.3) * 0.012;  // bụng phình trước ngực
```

Chi tiết + idle sway + height bob khi đi: `docs/03-body-parts/spine.md`.

---

## Head & Neck

**Phân phối**: Head 65%, Neck 35%. Euler order `"YXZ"` (yaw trước pitch tránh gimbal lock).

**Spring damper cho neck** (follow-through — cổ trễ nhẹ so với đầu):

```js
const STIFFNESS = 18, DAMPING = 6;
function updateNeckSpring(s, targetYaw, targetPitch, dt) {
  ["yaw", "pitch"].forEach(axis => {
    const tgt = axis === "yaw" ? targetYaw : targetPitch;
    const force = -STIFFNESS * (s[axis] - tgt) - DAMPING * s[`v_${axis}`];
    s[`v_${axis}`] += force * dt;
    s[axis]        += s[`v_${axis}`] * dt;
  });
}
```

⚠️ `dt` PHẢI là giây — millisecond làm spring blow up.

**Joint limits** (radian):

```
Head:  pitch [-0.55, +0.45]   yaw [-0.70, +0.70]   roll [-0.30, +0.30]
Neck:  pitch [-0.35, +0.25]   yaw [-0.45, +0.45]   roll [-0.20, +0.20]
```

Idle micro-movement khi không có tracking, head bob theo thở: `docs/03-body-parts/head-neck.md`.

---

## Arm — Two-bone IK

**Bài toán**: cho `wristTarget` + `shoulderPos`, tìm góc shoulder + elbow.

**Law of cosines**:

```js
function solveTwoBoneIK(shoulderPos, upperLen, lowerLen, target) {
  const dist = THREE.MathUtils.clamp(
    shoulderPos.distanceTo(target),
    Math.abs(upperLen - lowerLen) + 0.001,
    upperLen + lowerLen - 0.001,
  );
  const cosElbow    = (upperLen**2 + lowerLen**2 - dist**2) / (2 * upperLen * lowerLen);
  const cosShoulder = (upperLen**2 + dist**2 - lowerLen**2) / (2 * upperLen * dist);
  return {
    elbowAngle:    Math.acos(THREE.MathUtils.clamp(cosElbow,    -1, 1)),
    shoulderAngle: Math.acos(THREE.MathUtils.clamp(cosShoulder, -1, 1)),
  };
}
```

**Pole vector** (BẮT BUỘC — không có thì khuỷu lật ngược):

```js
const POLE = {
  left:  new THREE.Vector3(-1, -0.3, 0.5),  // ra ngoài + ra trước
  right: new THREE.Vector3(+1, -0.3, 0.5),
};
```

**Joint limits**:

```
Shoulder pitch [-2.0, +2.9]   roll [-0.3, +2.6]   yaw [-1.6, +1.6]
Elbow flex   [-2.6, 0]        roll = 0 (LOCK)     yaw [-1.4, +1.4]
Wrist pitch  [-0.87, +0.96]   roll [-0.35, +0.35] yaw = 0 (LOCK)
```

**Shoulder droop** khi tay duỗi xuống — vai chùng nhẹ.

**Idle target** khi không có Pose:

```js
const ARM_IDLE = {
  left:  new THREE.Vector3(-0.18, -0.55, 0.05),         // local space hips
  right: new THREE.Vector3(+0.18, -0.55, 0.05),
};
```

Chi tiết + forearm twist: `docs/03-body-parts/arm.md`.

---

## Hand — Finger curl + spread

**Curl** [0=duỗi, 1=nắm chặt] tính từ hand landmarks:

```js
function computeFingerCurl(landmarks, wristIdx, [mcp, pip, dip, tip]) {
  // Tổng góc gập tại MCP + PIP + DIP, weighted
  const v0 = vec(landmarks[wristIdx], landmarks[mcp]);
  const v1 = vec(landmarks[mcp], landmarks[pip]);
  const v2 = vec(landmarks[pip], landmarks[dip]);
  const v3 = vec(landmarks[dip], landmarks[tip]);
  const a1 = angleBetween(v0, v1);
  const a2 = angleBetween(v1, v2);
  const a3 = angleBetween(v2, v3);
  return THREE.MathUtils.clamp((a1 * 0.3 + a2 * 0.4 + a3 * 0.3) / (Math.PI * 0.8), 0, 1);
}
```

**Áp curl lên bones** (4 ngón, ngón cái khác):

```
MCP flex max = 1.57   (≈90°)
PIP flex max = 1.75   (≈100°)
DIP flex max = 1.22   (≈70°)   — luôn ≤ PIP × 0.85
```

**Preset poses**: `idle`, `open`, `fist`, `point`, `peace`. Lerp giữa current ↔ target với α = 0.40.

**Finger lag** (secondary motion) — ngón trễ khi cổ tay di chuyển nhanh, dùng spring damper.

**Thumb đặc biệt**: dùng `rotation.z` cho opposition (chụm về ngón trỏ), không phải `.x`.

Chi tiết: `docs/03-body-parts/hand.md`.

---

## Leg — IK + ground contact

**IK**: same as arm (Law of cosines), pole vector hướng RA TRƯỚC (đầu gối cong tới trước):

```js
const LEG_POLE = {
  left:  new THREE.Vector3(-0.05, 0, +0.8),
  right: new THREE.Vector3(+0.05, 0, +0.8),
};
```

**Knee pop prevention** — luôn giữ đầu gối cong ≥ 0.08 rad (~5°), không cho duỗi thẳng hoàn toàn → tránh hyperextend khi blend.

**Ground snap** với Raycaster mỗi frame:

```js
function snapFootToGround(target, scene, raycaster) {
  raycaster.set(
    new THREE.Vector3(target.x, target.y + 1.0, target.z),
    new THREE.Vector3(0, -1, 0),
  );
  const hit = raycaster.intersectObjects(scene.children, true)[0];
  if (hit) {
    target.y = hit.point.y;
    return hit.face.normal.clone();
  }
  return new THREE.Vector3(0, 1, 0);                    // fallback sàn phẳng
}
```

**Foot alignment** — `setFromUnitVectors(footUp, groundNormal)` để bàn chân theo độ dốc.

**Heel-to-toe roll** khi bước: ankle pitch theo `stepContact` (0=trên không, 0.3=gót, 0.7=cả bàn, 1.0=mũi đẩy).

**Joint limits**:

```
Hip   pitch [-2.1, +0.5]   roll [-0.7, +0.5]   yaw [-0.7, +0.7]
Knee  flex  [-2.6, 0]      roll = 0 (LOCK)     yaw = 0 (LOCK)
Ankle pitch [-0.52, +0.70] roll [-0.35, +0.52] yaw [-0.26, +0.26]
```

Idle weight shift, hip sway khi đi: `docs/03-body-parts/leg.md`.

---

## Khi nào fallback idle?

```js
const target = trackingState.poseDetected
  ? trackingState.leftWristPos
  : bones.Hips.localToWorld(ARM_IDLE.left.clone());
```

→ Pattern: nếu MediaPipe không có data tin cậy, dùng target idle trong local space của Hips.

## Common pitfalls

| Triệu chứng | Fix |
|-------------|-----|
| Lưng gập gãy 1 chỗ | Dùng `SPINE_WEIGHTS`, không dồn 1 bone |
| Cổ rung | Tăng damping spring; clamp dt ≤ 0.05 |
| Khuỷu/đầu gối lật | Set pole vector |
| Chân nổi/xuyên sàn | Raycaster mỗi frame |
| Đầu gối hyperextend | `Math.max(kneeAngle, 0.08)` |
| Tay không tới vị trí | Sai worldScale → đọc skill `character-rig` |
| Rotation accumulate dần | Dùng `=`, không dùng `+=` cho static pose |

## Reference

- Master loop: `docs/02-rig/character-controller.md` (gọi tất cả update functions theo thứ tự).
- Code chưa có cho từng bộ phận — đang ở Phase 2-4 trong `docs/00-overview/plan.md`.
