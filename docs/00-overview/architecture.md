# Architecture — Kiến trúc tổng thể

> Đọc đầu tiên. Cách hệ thống tổ chức bộ phận cơ thể, hierarchy xương, và nguồn input cho từng vùng.

**When to read**: lần đầu vào project, hoặc cần biết file nào quản lý bộ phận nào.

---

## Mỗi bộ phận = một object độc lập

| Đặc điểm | Lý do |
|----------|-------|
| Có bone hierarchy riêng (cha → con) | Update parent trước con |
| Có nguồn input riêng (MediaPipe / procedural / animation clip) | Fallback dễ khi tracking mất |
| Có joint constraint riêng (giới hạn góc xoay) | Tránh trông bất thường |
| Có smoothing state riêng (lerp / spring) | Loại bỏ jitter từ input |
| Có secondary motion (follow-through, jiggle) | Trông sống động |

---

## Hierarchy xương toàn thân

```
ROOT (Hips)
├── Spine ──→ Chest ──→ UpperChest
│   └── Neck ──→ Head
│         ├── EyeLeft / EyeRight       ← face_mesh.js + eye_control.js
│         └── Jaw
│
├── ShoulderLeft ──→ UpperArmLeft ──→ LowerArmLeft ──→ HandLeft
│                                                       ├── Index (proximal → middle → distal)
│                                                       ├── Middle
│                                                       ├── Ring
│                                                       ├── Little
│                                                       └── Thumb (metacarpal → proximal → distal)
│
├── ShoulderRight ──→ UpperArmRight ──→ LowerArmRight ──→ HandRight
│                                                          └── (tương tự, đảo bên)
│
├── UpperLegLeft ──→ LowerLegLeft ──→ FootLeft ──→ ToesLeft
└── UpperLegRight ──→ LowerLegRight ──→ FootRight ──→ ToesRight
```

---

## Nguồn input cho từng bộ phận

| Bộ phận | Nguồn input | File hiện có |
|---------|-------------|--------------|
| Khuôn mặt (52 blendshape) | MediaPipe FaceLandmarker | `script/face_mesh.js` ✅ |
| Mắt (rotation) | Iris landmarks 468–477 | `script/eye_control.js` ✅ |
| Đầu / Cổ | Face landmarks (head pose math) | `script/face_tracking_utils.js` ✅ |
| Cột sống | MediaPipe Pose / procedural lean | _planned_ |
| Cánh tay | MediaPipe Pose / two-bone IK | _planned_ |
| Bàn tay / Ngón | MediaPipe HandLandmarker | _planned_ |
| Chân / Bàn chân | MediaPipe Pose / IK + ground | _planned_ |

Demo skeletal animation đầy đủ (idle/walk/punch + wave gesture): `script/animation/character.js`.

---

## MediaPipe Pose — 33 Landmark Index

```
0  = Nose              11 = L_Shoulder      23 = L_Hip
1  = L_EyeInner        12 = R_Shoulder      24 = R_Hip
2  = L_Eye             13 = L_Elbow         25 = L_Knee
3  = L_EyeOuter        14 = R_Elbow         26 = R_Knee
4  = R_EyeInner        15 = L_Wrist         27 = L_Ankle
5  = R_Eye             16 = R_Wrist         28 = R_Ankle
6  = R_EyeOuter        17 = L_Pinky         29 = L_Heel
7  = L_Ear             18 = R_Pinky         30 = R_Heel
8  = R_Ear             19 = L_Index         31 = L_FootIndex
9  = L_MouthLeft       20 = R_Index         32 = R_FootIndex
10 = R_MouthRight      21 = L_Thumb
                       22 = R_Thumb
```

> "Left" ở đây là **camera space** (trái màn hình) — webcam selfie đảo → cần swap khi map sang model. Xem [glossary.md §16](glossary.md#16-quy-ước-lr--tráiphải).

---

## MediaPipe Hand — 21 Landmark Index (mỗi tay)

```
0  = Wrist
1  = ThumbCMC   2  = ThumbMCP   3  = ThumbIP    4  = ThumbTip
5  = IndexMCP   6  = IndexPIP   7  = IndexDIP   8  = IndexTip
9  = MiddleMCP  10 = MiddlePIP  11 = MiddleDIP  12 = MiddleTip
13 = RingMCP    14 = RingPIP    15 = RingDIP    16 = RingTip
17 = LittleMCP  18 = LittlePIP  19 = LittleDIP  20 = LittleTip
```

---

## Nguyên tắc chung khi code chuyển động tự nhiên

### 1. Không set rotation trực tiếp từ input thô

```js
// ❌ Giật, thiếu tự nhiên
bone.rotation.y = rawValue;

// ✅ Lerp để mượt
bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, rawValue, 0.3);
```

### 2. Spring damper cho secondary motion

```js
// acceleration = -stiffness * displacement - damping * velocity
velocity += (-stiffness * (current - target) - damping * velocity) * dt;
current  += velocity * dt;
```

### 3. Luôn clamp joint limits

Mỗi khớp có giới hạn xoay — vượt qua = trông bất thường. Bảng joint limits ở [03-body-parts/](../03-body-parts/) cho từng vùng.

```js
bone.rotation.x = THREE.MathUtils.clamp(value, MIN_X, MAX_X);
```

### 4. Hierarchy = tính từ gốc → ngọn

```
Hips → Spine → Chest → UpperChest → Shoulder → Arm → Hand → Finger
```

Xoay khớp cha ảnh hưởng toàn bộ chuỗi con.

### 5. FK vs IK

| | FK (Forward Kinematics) | IK (Inverse Kinematics) |
|-|-----|----|
| Input | Góc từng khớp | Vị trí đích (target) |
| Dùng cho | Spine, neck, ngón tay | Cánh tay, chân, tay chạm vật |
| Ưu | Đơn giản, kiểm soát tốt | Tự nhiên với target cụ thể |
| Nhược | Khó đặt tay đúng vị trí | Có thể lật khớp nếu thiếu pole vector |

---

## Thứ tự cập nhật mỗi frame

```
1. Cập nhật ROOT position (di chuyển nhân vật)
2. Hips rotation (từ lean / sway)
3. Spine chain  (từ gốc lên đỉnh)
4. Head / Neck  (từ face tracking)
5. Eyes         (từ iris tracking)
6. Shoulder / Arm / Hand (IK từ wrist target)
7. Fingers      (từ hand landmarks)
8. Leg / Foot   (IK + ground contact)
9. Procedural breathing (cộng vào cuối)
```

Master implementation: [../02-rig/character-controller.md](../02-rig/character-controller.md).

---

← Prev: — | **Up**: [README](../README.md) | Next: [glossary.md →](glossary.md)
