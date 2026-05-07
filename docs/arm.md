# Arm — Cánh tay (Shoulder → Elbow → Wrist)

## Object definition

```js
const Arm = {
  side: "left" | "right",

  // Bones
  shoulder:  THREE.Bone,    // UpperChest → Shoulder
  upperArm:  THREE.Bone,    // Shoulder → UpperArm
  lowerArm:  THREE.Bone,    // UpperArm → LowerArm (Forearm)
  hand:      THREE.Bone,    // LowerArm → Hand

  // IK state
  ikTarget:      THREE.Vector3,   // vị trí đích của cổ tay
  poleTarget:    THREE.Vector3,   // hướng khuỷu tay muốn cong ra

  // Lengths (đo từ model)
  upperArmLength: number,   // ví dụ: 0.28 (units)
  lowerArmLength: number,   // ví dụ: 0.26 (units)

  // Spring state cho shoulder droop
  shoulderVelocity: { x: 0, y: 0, z: 0 },
}
```

---

## 1. Two-Bone IK — Giải bài toán cánh tay

Cho biết vị trí `wristTarget` (đích của cổ tay) và vị trí `shoulderPos` (gốc vai),
tìm góc khuỷu tay sao cho cổ tay chạm đích.

### 1a. Kiểm tra reach

```js
const shoulderToTarget = wristTarget.clone().sub(shoulderPos);
const distance = shoulderToTarget.length();

const maxReach = upperArmLength + lowerArmLength;        // duỗi thẳng tối đa
const minReach = Math.abs(upperArmLength - lowerArmLength); // gấp tối đa

// Clamp distance vào range có thể với tới
const reachDist = THREE.MathUtils.clamp(distance, minReach + 0.001, maxReach - 0.001);
```

### 1b. Tính góc khuỷu (Law of Cosines)

```
Tam giác: A = UpperArm, B = LowerArm, C = đường thẳng shoulder→wrist

Góc tại khuỷu (elbowAngle):
  cos(elbowAngle) = (A² + B² - C²) / (2 × A × B)
  elbowAngle = acos(clamp(cos_val, -1, 1))

Góc shoulder (shoulderAngle):
  cos(shoulderAngle) = (A² + C² - B²) / (2 × A × C)
  shoulderAngle = acos(clamp(cos_val, -1, 1))
```

```js
function solveTwoBoneIK(shoulderPos, upperLen, lowerLen, targetPos) {
  const dist = THREE.MathUtils.clamp(
    shoulderPos.distanceTo(targetPos),
    Math.abs(upperLen - lowerLen) + 0.001,
    upperLen + lowerLen - 0.001,
  );

  // Law of Cosines
  const cosElbow    = (upperLen * upperLen + lowerLen * lowerLen - dist * dist)
                    / (2 * upperLen * lowerLen);
  const cosShoulder = (upperLen * upperLen + dist * dist - lowerLen * lowerLen)
                    / (2 * upperLen * dist);

  return {
    elbowAngle:    Math.acos(THREE.MathUtils.clamp(cosElbow,    -1, 1)),
    shoulderAngle: Math.acos(THREE.MathUtils.clamp(cosShoulder, -1, 1)),
  };
}
```

---

## 2. Pole Vector — Hướng cong của khuỷu tay

Không có pole vector → khuỷu có thể cong theo bất kỳ chiều nào.
Pole vector là điểm thứ 3 xác định **mặt phẳng** cánh tay nằm trong đó.

```
Mặc định khi tay thả xuống:
  Left arm  pole = shoulder_pos + Vector3(-1, -0.3, 0.5)  ← khuỷu cong ra ngoài + ra trước
  Right arm pole = shoulder_pos + Vector3(+1, -0.3, 0.5)
```

```js
function computeElbowPlane(shoulderPos, wristTarget, poleTarget) {
  const toTarget = wristTarget.clone().sub(shoulderPos).normalize();
  const toPole   = poleTarget.clone().sub(shoulderPos).normalize();

  // Normal của mặt phẳng cánh tay
  const planeNormal = new THREE.Vector3().crossVectors(toTarget, toPole).normalize();

  // Hướng khuỷu (perpendicular với arm, trong mặt phẳng)
  const elbowDir = new THREE.Vector3().crossVectors(planeNormal, toTarget).normalize();

  return { planeNormal, elbowDir };
}
```

---

## 3. Áp IK lên bones trong Three.js

```js
function applyArmIK(arm, wristTarget) {
  const shoulderWorldPos = arm.shoulder.getWorldPosition(new THREE.Vector3());

  // Giải IK
  const { elbowAngle, shoulderAngle } = solveTwoBoneIK(
    shoulderWorldPos,
    arm.upperArmLength,
    arm.lowerArmLength,
    wristTarget,
  );

  const { elbowDir } = computeElbowPlane(shoulderWorldPos, wristTarget, arm.poleTarget);

  // Vị trí khuỷu
  const elbowPos = shoulderWorldPos.clone()
    .add(elbowDir.clone().multiplyScalar(Math.sin(shoulderAngle) * arm.upperArmLength))
    .add(wristTarget.clone().sub(shoulderWorldPos).normalize()
         .multiplyScalar(Math.cos(shoulderAngle) * arm.upperArmLength));

  // UpperArm: nhìn từ shoulder về elbow
  const upperArmDir = elbowPos.clone().sub(shoulderWorldPos).normalize();
  arm.upperArm.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, -1, 0),   // bone rest direction (trục bone gốc)
    upperArmDir,
  );

  // LowerArm: nhìn từ elbow về wrist
  const lowerArmDir = wristTarget.clone().sub(elbowPos).normalize();
  arm.lowerArm.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, -1, 0),
    lowerArmDir,
  );
}
```

---

## 4. Shoulder Droop — Vai chùng theo trọng lực

Khi tay duỗi xuống, vai tự nhiên chùng xuống một chút:

```js
const SHOULDER_DROOP_FACTOR = 0.15;  // độ chùng tối đa (rad)

function computeShoulderDroop(wristTarget, shoulderPos) {
  // Nếu cổ tay dưới vai → vai chùng xuống
  const verticalOffset = shoulderPos.y - wristTarget.y;
  const droop = THREE.MathUtils.clamp(verticalOffset × 0.2, 0, SHOULDER_DROOP_FACTOR);

  return droop;   // áp vào shoulder.rotation.z (nghiêng vai)
}
```

---

## 5. Joint Constraints cánh tay

```
SHOULDER (ball joint):
  Flex/Extend (pitch):  [-2.0, +2.9] rad   ≈ [-115°, +165°]  (giơ tay lên/hạ tay xuống)
  Abduction  (roll):    [-0.3, +2.6] rad   ≈ [-17°, +150°]   (dang tay ngang)
  Rotation   (yaw):     [-1.6, +1.6] rad   ≈ ±90°             (xoay cánh tay)

ELBOW (hinge joint — CHỈ flex/extend):
  Flex  (pitch):        [-2.6, 0.0]  rad   ≈ [-150°, 0°]
  Twist (yaw):          [-1.4, +1.4] rad   ≈ ±80°   (forearm pronation/supination)
  Roll  (z):            KHÓA = 0           (không cong ngang)

WRIST:
  Flex/Extend (pitch):  [-0.87, +0.96] rad  ≈ [-50°, +55°]
  Deviation   (roll):   [-0.35, +0.35] rad  ≈ ±20°
  Twist       (yaw):    KHÓA (handled bởi forearm)
```

---

## 6. Arm Idle — Tay thả tự nhiên khi đứng yên

Khi không có IK target, tay thả tự nhiên với một chút swing theo thở:

```js
// Tất cả giá trị là offset trong LOCAL SPACE của Hips bone.
// x: ngang (âm = trái), y: dọc (âm = xuống dưới hông), z: trước/sau
const ARM_IDLE_TARGET = {
  left:  new THREE.Vector3(-0.18, -0.55, 0.05),
  right: new THREE.Vector3(+0.18, -0.55, 0.05),
};
// Để chuyển sang world space khi dùng IK:
// const worldTarget = ARM_IDLE_TARGET.left.clone()
//   .applyMatrix4(hips.matrixWorld);

// Thêm swing nhẹ theo breath
const breathSwing = Math.sin(breathPhase) × 0.008;
ARM_IDLE_TARGET.left.y  += breathSwing;
ARM_IDLE_TARGET.right.y -= breathSwing;  // ngược phase → 2 tay đồng bộ thở
```

---

## 7. Lấy IK target từ MediaPipe Pose

```js
// Pose landmarks: 15=L_Wrist, 16=R_Wrist
function getArmIKTargetsFromPose(poseLandmarks, worldScale) {
  const lWrist = poseLandmarks[15];
  const rWrist = poseLandmarks[16];

  // Chuyển từ normalize [0,1] sang world units
  // MediaPipe Pose: x,y trong [0,1] tương ứng với video frame
  // z là depth (tương đối, không chính xác)
  return {
    left:  new THREE.Vector3(
      -(lWrist.x - 0.5) × worldScale.x,   // mirror X
       (0.5 - lWrist.y) × worldScale.y,
      -lWrist.z          × worldScale.z,
    ),
    right: new THREE.Vector3(
      -(rWrist.x - 0.5) × worldScale.x,
       (0.5 - rWrist.y) × worldScale.y,
      -rWrist.z          × worldScale.z,
    ),
  };
}
```

---

## 8. Forearm Twist (Pronation/Supination)

Khi bàn tay xoay (lật ngửa/úp), xương forearm xoắn.
Phân phối xoắn giữa elbow và wrist:

```js
// twistAngle: góc xoay bàn tay [-π, +π]
const LOWER_ARM_TWIST_RATIO = 0.6;   // 60% twist vào lower arm
const WRIST_TWIST_RATIO     = 0.4;   // 40% còn lại vào wrist

lowerArm.rotation.y += twistAngle × LOWER_ARM_TWIST_RATIO;
hand.rotation.y     += twistAngle × WRIST_TWIST_RATIO;
```

---

## 9. Thứ tự tính toán mỗi frame

```
1. Lấy wristTarget (từ Pose / IK target / idle)
2. Làm mượt target: lerpTarget(current, target, 0.25)
3. solveTwoBoneIK(shoulder, upper, lower, target)
4. computeElbowPlane(shoulder, target, pole)
5. applyArmIK(bones, angles)
6. computeShoulderDroop(target, shoulder) → shoulder.rotation
7. applyForearmTwist(hand.rotation.y)
8. Clamp tất cả joints
```

---

## Lưu ý quan trọng khi code

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Khuỷu lật ngược | Không có pole vector | Luôn set `poleTarget` hợp lý |
| Tay duỗi thẳng cứng | Target vượt `maxReach` | Clamp target distance về `maxReach - 0.001` |
| Tay rung khi gần đích | `lerp` factor quá cao | Giảm lerp factor hoặc dùng spring damper |
| Vai không chuyển động | Quên shoulder droop | Áp `droop` vào `shoulder.rotation.z` |
| Khuỷu chui vào thân | Pole vector sai | Pole phải nằm **phía trước** và **ngoài** cơ thể |
| Forearm twist sai | Quên phân phối | Dùng tỉ lệ 60/40 giữa lowerArm và wrist |
