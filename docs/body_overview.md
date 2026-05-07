# Full Body Character — Tổng quan hệ thống

## Kiến trúc bộ phận

Mỗi bộ phận cơ thể được thiết kế như một **object độc lập** có:
- Bone hierarchy (chuỗi xương cha–con)
- Input source (MediaPipe / procedural / animation)
- Joint constraints (giới hạn góc xoay)
- Smoothing state (lerp / spring)
- Secondary motion (follow-through, jiggle)

---

## Hierarchy xương toàn thân

```
ROOT (Hips)
├── Spine0  ──→ Spine1 ──→ Spine2 (UpperChest)
│     └── Neck ──→ Head
│           ├── EyeLeft  / EyeRight       ← face_mesh.js + eye_control.js
│           └── Jaw
│
├── ShoulderLeft ──→ UpperArmLeft ──→ LowerArmLeft ──→ HandLeft
│                                                         ├── IndexProximal → IndexMiddle → IndexDistal
│                                                         ├── MiddleProximal → ...
│                                                         ├── RingProximal → ...
│                                                         ├── LittleProximal → ...
│                                                         └── ThumbMetacarpal → ThumbProximal → ThumbDistal
│
├── ShoulderRight ──→ UpperArmRight ──→ LowerArmRight ──→ HandRight
│                                                           └── (tương tự)
│
├── UpperLegLeft ──→ LowerLegLeft ──→ FootLeft ──→ ToesLeft
└── UpperLegRight ──→ LowerLegRight ──→ FootRight ──→ ToesRight
```

---

## Nguồn input cho từng bộ phận

| Bộ phận | Nguồn input | File |
|---------|-------------|------|
| Khuôn mặt (52 blendshapes) | MediaPipe FaceLandmarker | `face_mesh.js` |
| Mắt (rotation) | Iris landmarks 468–477 | `eye_control.js` |
| Đầu / Cổ | Face landmarks (pose estimation) | `face_tracking_utils.js` |
| Cột sống | MediaPipe Pose / Procedural lean | `spine.js` *(planned)* |
| Cánh tay | MediaPipe Pose / 2-bone IK | `arm.js` *(planned)* |
| Bàn tay / Ngón | MediaPipe HandLandmarker | `hand.js` *(planned)* |
| Chân / Bàn chân | MediaPipe Pose / Foot IK | `leg.js` *(planned)* |

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

### 1. Không bao giờ set rotation trực tiếp từ input thô

```js
// ❌ SAI — giật, thiếu tự nhiên
bone.rotation.y = rawValue;

// ✅ ĐÚNG — lerp để làm mượt
bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, rawValue, 0.3);
```

### 2. Dùng Spring Damper cho secondary motion

```js
// Mô phỏng lò xo: acceleration = -stiffness * displacement - damping * velocity
velocity += (-stiffness * (current - target) - damping * velocity) * dt;
current  += velocity * dt;
```

### 3. Luôn clamp joint limits

```js
// Mỗi khớp có giới hạn xoay — vượt qua = trông bất thường
bone.rotation.x = THREE.MathUtils.clamp(value, MIN_X, MAX_X);
```

### 4. Hierarchy = tính toán từ gốc ra ngọn

```
Root → Hips → Spine → Chest → Shoulder → Arm → Hand → Finger
```
Xoay ở khớp cha ảnh hưởng toàn bộ chuỗi con.

### 5. Forward Kinematics (FK) vs Inverse Kinematics (IK)

| | FK | IK |
|-|----|----|
| Input | Góc từng khớp | Vị trí đích (target) |
| Dùng cho | Cột sống, cổ, ngón tay | Cánh tay, chân, bàn tay chạm vật |
| Ưu điểm | Đơn giản, kiểm soát tốt | Tự nhiên khi có target cụ thể |
| Nhược điểm | Khó đặt tay đúng vị trí | Có thể lật khớp nếu không có pole vector |

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
8. Leg / Foot   (IK từ foot target + ground contact)
```

---

## Files documentation

| File | Mô tả |
|------|-------|
| `face_mesh.md` | Khuôn mặt, blendshapes, head pose |
| `head_neck.md` | Cổ, follow-through, secondary motion |
| `spine.md` | Cột sống, hô hấp, lean, sway |
| `arm.md` | Vai + cánh tay, 2-bone IK, elbow twist |
| `hand.md` | Bàn tay + 5 ngón tay, finger curl/spread |
| `leg.md` | Chân, foot IK, ground contact, knee pole |
