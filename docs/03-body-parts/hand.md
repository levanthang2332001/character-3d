# Hand & Fingers — Bàn tay và ngón tay

> Tính curl/spread từ MediaPipe hand landmarks, áp lên bones (4 ngón + thumb opposition đặc biệt), preset poses, finger lag (secondary motion via spring damper), wrist rotation.

**When to read**: Phase 3 — viết `hand_controller.js`. Hoặc thêm preset pose mới (peace, point, …).

---

## Object definition

```js
const Hand = {
  side: "left" | "right",

  // Bones
  wrist: THREE.Bone,

  fingers: {
    thumb:  { metacarpal: Bone, proximal: Bone, distal: Bone },          // 3 khớp
    index:  { metacarpal: Bone, proximal: Bone, middle: Bone, distal: Bone },  // 4 khớp
    middle: { metacarpal: Bone, proximal: Bone, middle: Bone, distal: Bone },
    ring:   { metacarpal: Bone, proximal: Bone, middle: Bone, distal: Bone },
    little: { metacarpal: Bone, proximal: Bone, middle: Bone, distal: Bone },
  },

  // State
  poseTarget: {
    // Mỗi ngón: { curl: 0→1, spread: -1→+1 }
    thumb:  { curl: 0, spread: 0 },
    index:  { curl: 0, spread: 0 },
    middle: { curl: 0, spread: 0 },
    ring:   { curl: 0, spread: 0 },
    little: { curl: 0, spread: 0 },
  },
  poseCurrent: { /* same structure */ },
}
```

---

## 1. Cấu trúc xương ngón tay

### 4 ngón (index, middle, ring, little):
```
Wrist → Metacarpal (0) → ProximalPhalanx (1) → MiddlePhalanx (2) → DistalPhalanx (3)
         (bàn tay)          (đốt gốc)              (đốt giữa)          (đốt ngọn)
```

### Ngón cái (thumb):
```
Wrist → ThumbMetacarpal (0) → ProximalPhalanx (1) → DistalPhalanx (2)
                                                       (không có middle)
```

### Tỷ lệ độ dài (chuẩn hóa theo chiều dài ngón index = 1.0):
```
Index  : [0.7, 1.0, 0.75, 0.5]   (metacarpal, proximal, middle, distal)
Middle : [0.7, 1.1, 0.82, 0.5]
Ring   : [0.7, 0.95, 0.75, 0.5]
Little : [0.65, 0.7, 0.6, 0.45]
Thumb  : [0.6, 0.8, 0.6]
```

---

## 2. MediaPipe Hand — 21 Landmark Index

```
0  = Wrist
1  = ThumbCMC   2  = ThumbMCP   3  = ThumbIP    4  = ThumbTip
5  = IndexMCP   6  = IndexPIP   7  = IndexDIP   8  = IndexTip
9  = MiddleMCP  10 = MiddlePIP  11 = MiddleDIP  12 = MiddleTip
13 = RingMCP    14 = RingPIP    15 = RingDIP    16 = RingTip
17 = LittleMCP  18 = LittlePIP  19 = LittleDIP  20 = LittleTip
```

---

## 3. Helper Functions (dùng chung cho curl và spread)

```js
// Tính vector từ điểm a đến điểm b (từ MediaPipe landmark {x,y,z})
function vectorFromTo(a, b) {
  return new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
}

// Góc giữa 2 vector (radian)
function angleBetween(a, b) {
  return Math.acos(THREE.MathUtils.clamp(
    a.dot(b) / (a.length() * b.length()), -1, 1
  ));
}
```

---

## 4. Tính Curl từ MediaPipe Landmarks

Curl = mức độ gập ngón tay [0 = duỗi thẳng, 1 = nắm chặt].

```js
/**
 * Tính curl của một ngón dựa vào góc gập tại từng khớp.
 * landmarks: mảng 21 điểm từ MediaPipe HandLandmarker
 * fingerIndices: [MCP, PIP, DIP, Tip] hoặc [CMC, MCP, IP, Tip]
 */
function computeFingerCurl(landmarks, wristIdx, fingerIndices) {
  const [mcp, pip, dip, tip] = fingerIndices.map(i => landmarks[i]);
  const wrist = landmarks[wristIdx];

  // Vector từng đốt
  const v0 = vectorFromTo(wrist, mcp);   // bàn tay → gốc ngón
  const v1 = vectorFromTo(mcp, pip);     // gốc → giữa
  const v2 = vectorFromTo(pip, dip);     // giữa → ngọn
  const v3 = vectorFromTo(dip, tip);     // ngọn → đầu ngón

  // Góc gập tại mỗi khớp (dot product → angle)
  const angle1 = angleBetween(v0, v1);   // tại MCP
  const angle2 = angleBetween(v1, v2);   // tại PIP
  const angle3 = angleBetween(v2, v3);   // tại DIP

  // Tổng hợp curl: PIP + DIP quan trọng hơn MCP
  const totalCurl = (angle1 * 0.3 + angle2 * 0.4 + angle3 * 0.3) / (Math.PI * 0.8);
  return THREE.MathUtils.clamp(totalCurl, 0, 1);
}

// (xem section 3 — Helper Functions)
```

---

## 5. Tính Spread từ MediaPipe Landmarks

Spread = khoảng cách ngang giữa các ngón [-1 = khép, +1 = xòe].

```js
function computeFingerSpread(landmarks, fingerAIndices, fingerBIndices) {
  // Lấy điểm MCP của 2 ngón kề nhau
  const mcpA = landmarks[fingerAIndices[0]];
  const mcpB = landmarks[fingerBIndices[0]];
  const wrist = landmarks[0];

  // Đo góc giữa 2 ngón tại gốc
  const vA = vectorFromTo(wrist, mcpA).normalize();
  const vB = vectorFromTo(wrist, mcpB).normalize();

  const spreadAngle = angleBetween(vA, vB);  // 0 rad = khép, ~0.35 rad = xòe max
  return THREE.MathUtils.clamp(spreadAngle / 0.30 - 1, -1, 1);  // map về [-1,1]
}
```

---

## 6. Áp Curl/Spread lên Bones

### Curl angles cho từng khớp:
```
Khi curl = 1.0 (nắm chặt):
  MCP  (gốc): flex 90°  = 1.57 rad
  PIP  (giữa): flex 100° = 1.75 rad
  DIP  (ngọn): flex 70°  = 1.22 rad
```

```js
const CURL_ANGLES = {
  mcp:  { min: 0, max: 1.57 },
  pip:  { min: 0, max: 1.75 },
  dip:  { min: 0, max: 1.22 },
};

function applyCurlToFinger(finger, curlValue) {
  // lerp giữa duỗi thẳng và nắm chặt
  finger.proximal.rotation.x = THREE.MathUtils.lerp(
    CURL_ANGLES.mcp.min, CURL_ANGLES.mcp.max, curlValue
  );
  finger.middle.rotation.x = THREE.MathUtils.lerp(
    CURL_ANGLES.pip.min, CURL_ANGLES.pip.max, curlValue
  );
  finger.distal.rotation.x = THREE.MathUtils.lerp(
    CURL_ANGLES.dip.min, CURL_ANGLES.dip.max, curlValue * 0.85  // ngọn gập ít hơn một chút
  );
}

function applySpreadToFinger(finger, spreadValue) {
  const SPREAD_MAX = 0.18;  // rad ~10°
  finger.proximal.rotation.z = spreadValue × SPREAD_MAX;
}
```

---

## 7. Ngón cái — Thumb (khác biệt)

Ngón cái có chuyển động đặc biệt: **opposition** (chụm về phía các ngón khác).

```js
const THUMB_CURL_ANGLES = {
  metacarpal: { min: 0.2, max: 1.0 },   // CMC joint (gốc nhất)
  proximal:   { min: 0.1, max: 0.90 },
  distal:     { min: 0,   max: 0.70 },
};

const THUMB_OPPOSITION_MAX = 0.8;  // rad — chuyển về phía ngón index

function applyThumbCurl(thumb, curlValue, oppositionValue = 0) {
  thumb.metacarpal.rotation.x = lerp(THUMB_CURL_ANGLES.metacarpal.min,
                                      THUMB_CURL_ANGLES.metacarpal.max, curlValue);
  thumb.metacarpal.rotation.z = oppositionValue × THUMB_OPPOSITION_MAX;
  thumb.proximal.rotation.x   = lerp(THUMB_CURL_ANGLES.proximal.min,
                                      THUMB_CURL_ANGLES.proximal.max, curlValue);
  thumb.distal.rotation.x     = lerp(THUMB_CURL_ANGLES.distal.min,
                                      THUMB_CURL_ANGLES.distal.max, curlValue);
}
```

---

## 8. Preset Poses cho tay

```js
const HAND_POSES = {
  open: {
    thumb:  { curl: 0.05, spread: 0.2 },
    index:  { curl: 0,    spread: 0.1 },
    middle: { curl: 0,    spread: 0 },
    ring:   { curl: 0,    spread: -0.1 },
    little: { curl: 0.05, spread: -0.2 },
  },
  fist: {
    thumb:  { curl: 0.8, spread: 0, opposition: 0.7 },
    index:  { curl: 1,   spread: 0 },
    middle: { curl: 1,   spread: 0 },
    ring:   { curl: 1,   spread: 0 },
    little: { curl: 1,   spread: 0 },
  },
  point: {  // ngón trỏ duỗi, còn lại nắm
    thumb:  { curl: 0.7, spread: 0.1 },
    index:  { curl: 0,   spread: 0 },
    middle: { curl: 0.9, spread: 0 },
    ring:   { curl: 0.9, spread: 0 },
    little: { curl: 0.9, spread: 0 },
  },
  peace: {  // chữ V
    thumb:  { curl: 0.7, spread: 0 },
    index:  { curl: 0,   spread: 0.15 },
    middle: { curl: 0,   spread: -0.15 },
    ring:   { curl: 0.9, spread: 0 },
    little: { curl: 0.9, spread: 0 },
  },
  idle: {  // tay thả tự nhiên — hơi cong
    thumb:  { curl: 0.15, spread: 0.1 },
    index:  { curl: 0.12, spread: 0.05 },
    middle: { curl: 0.14, spread: 0 },
    ring:   { curl: 0.16, spread: -0.05 },
    little: { curl: 0.18, spread: -0.12 },
  },
};
```

---

## 9. Smoothing cho fingers

Ngón tay di chuyển nhanh hơn cánh tay → lerp factor cao hơn:

```js
const FINGER_LERP = 0.40;   // khá nhanh, ngón tay phản hồi nhanh

function updateFingerPose(hand, targetPose, dt) {
  for (const [fingerName, target] of Object.entries(targetPose)) {
    const current = hand.poseCurrent[fingerName];

    current.curl   = THREE.MathUtils.lerp(current.curl,   target.curl,   FINGER_LERP);
    current.spread = THREE.MathUtils.lerp(current.spread, target.spread, FINGER_LERP);

    // Áp lên bones
    applyCurlToFinger(hand.fingers[fingerName], current.curl);
    applySpreadToFinger(hand.fingers[fingerName], current.spread);
  }
}
```

---

## 10. Wrist Rotation

Cổ tay xoay theo hướng bàn tay hướng tới:

```js
// Nếu có IK target cho bàn tay, tính lookAt
const handForward  = new THREE.Vector3(0, 0, 1);  // rest direction của hand bone
const handTarget   = targetDirection.clone().normalize();

hand.wrist.quaternion.setFromUnitVectors(handForward, handTarget);

// Clamp wrist rotation
hand.wrist.rotation.x = THREE.MathUtils.clamp(hand.wrist.rotation.x, -0.87, 0.96);
hand.wrist.rotation.z = THREE.MathUtils.clamp(hand.wrist.rotation.z, -0.35, 0.35);
```

---

## 11. Secondary Motion — Finger Lag

Khi tay di chuyển nhanh, các ngón tay **trễ nhẹ** so với cổ tay (inertia):

```js
const FINGER_LAG_STIFFNESS = 25;
const FINGER_LAG_DAMPING   = 8;

// velocity của cổ tay (tính từ vị trí frame trước)
const wristVelocity = wristPos.clone().sub(lastWristPos).divideScalar(dt);

// Các ngón nặng hơn → lag nhiều hơn
const fingerLagCurl = THREE.MathUtils.clamp(wristVelocity.y × 0.15, -0.3, 0.3);

// Cộng vào curl của tất cả ngón (trừ ngón cái)
["index","middle","ring","little"].forEach(name => {
  hand.poseCurrent[name].curl += fingerLagCurl;
});
```

---

## Lưu ý quan trọng khi code

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Ngón tay chui vào nhau | Không check intersection | Giới hạn spread min/max theo vị trí ngón kế bên |
| Ngón cái xoay sai trục | Thumb rest axis khác 4 ngón | Thumb dùng rotation.z cho opposition, không phải .x |
| Ngón tay giật khi tracking | MediaPipe hand input noisy | Áp lerp 0.4, đừng dùng giá trị thô trực tiếp |
| Preset không khớp model | Tên bone khác nhau | Check tên bone trong model GLTF, map lại nếu cần |
| DIP curl bất thường | Quên giới hạn DIP < PIP | Đảm bảo `dip_angle ≤ pip_angle × 0.85` |

---

← Prev: [arm.md](arm.md) | **Up**: [README](../README.md) | Next: [leg.md →](leg.md)
