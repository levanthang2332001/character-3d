# PLAN — Build HoloBox Full Body Character

## Mục tiêu

Xây dựng nhân vật 3D full body cho HoloBox:
- **Đầu + mặt**: đã hoạt động (face tracking + blendshapes + eye control)
- **Toàn thân**: driven bởi MediaPipe Pose + Hand từ webcam
- **Procedural animation**: thở, idle sway, secondary motion
- **Render**: WebGPU / Three.js

---

## Tài liệu tham khảo (đọc trước khi code)

| File | Nội dung | Đọc khi |
|------|---------|---------|
| `face_mesh.md` | Face tracking pipeline hiện tại | Đã hoàn thành |
| `mediapipe_setup.md` | Setup PoseLandmarker + HandLandmarker | **Phase 1** |
| `model_setup.md` | Bone lookup, worldScale, calibration | **Phase 1** |
| `body_overview.md` | Kiến trúc tổng thể, hierarchy | Đọc đầu tiên |
| `head_neck.md` | Neck/head rotation, spring damper | **Phase 2** |
| `spine.md` | S-curve lean, breathing, twist | **Phase 2** |
| `arm.md` | Two-bone IK tay, pole vector | **Phase 3** |
| `hand.md` | Finger curl/spread, thumb | **Phase 3** |
| `leg.md` | Leg IK, foot ground contact | **Phase 4** |
| `character_controller.md` | Master loop, data flow | **Xuyên suốt** |

---

## Phase 0 — Chuẩn bị (Prerequisites)

### 0.1 Cần có model full body

Hiện tại `facecap.glb` chỉ là **head model**. Cần model mới:

```
Yêu cầu model:
✅ Skinned mesh với skeleton đầy đủ (Hips → Spine → Arms → Legs)
✅ 52 blend shapes trên face mesh
✅ T-pose hoặc A-pose
✅ Bone names theo convention VRM/Mixamo (xem model_setup.md §1)
✅ GLB format (binary GLTF)

Gợi ý nguồn:
- Ready Player Me (readyplayer.me) — free, VRM compatible
- Mixamo (mixamo.com) — free với Adobe account
- VRoid Studio — anime style, free
```

### 0.2 Cấu trúc file code

```
script/
  face_mesh.js         ← có sẵn (face tracking)
  facecap.js           ← có sẵn (Three.js scene) — sẽ refactor
  face_tracking_utils.js ← có sẵn
  eye_control.js        ← có sẵn
  lip_sync.js           ← có sẵn
  constants.js          ← có sẵn

  [MỚI - Phase 1]
  tracking_manager.js   ← quản lý 3 MediaPipe landmarkers + trackingState
  character_setup.js    ← initCharacter(), buildBoneMap(), worldScale

  [MỚI - Phase 2]
  spine_controller.js   ← updateSpine()
  head_neck_controller.js ← updateHeadNeck() (nâng cấp từ face_mesh.js)

  [MỚI - Phase 3]
  arm_controller.js     ← updateArm(), solveTwoBoneIK()
  hand_controller.js    ← updateHand(), computeFingerCurl()

  [MỚI - Phase 4]
  leg_controller.js     ← updateLeg(), snapFootToGround()

  [MỚI - Phase 5]
  character_controller.js ← updateCharacter() master loop
```

---

## Phase 1 — Foundation (Nền tảng)

**Mục tiêu**: Load full body model + setup tracking + có thể chạy basic scene

### Task 1.1: tracking_manager.js

```js
// Khởi tạo 3 landmarkers, export trackingState
export async function initTrackingManager(video) { ... }
export function runTrackingFrame(video, timestamp) { ... }
export const trackingState = { ... };
```

Tham khảo: `mediapipe_setup.md` toàn bộ

**Done khi**: Console log thấy `poseResult.worldLandmarks` có data

---

### Task 1.2: character_setup.js

```js
// Load model, build bone map, đo lengths, tính worldScale
export async function initCharacter(glbPath) { ... }
```

Tham khảo: `model_setup.md` toàn bộ

**Done khi**: `listAllBones(model)` in ra đủ tên bones, `boneLengths.leftUpperArmLength > 0`

---

### Task 1.3: Tích hợp vào facecap.js

Thêm gọi `initTrackingManager` và `initCharacter` vào startup sequence.

**Done khi**: Scene load, model hiện ra, tracking chạy background

---

## Phase 2 — Spine + Head/Neck

**Mục tiêu**: Thân trên phản ứng với Pose, đầu/cổ tách đúng

### Task 2.1: spine_controller.js

- `updateSpine(controller, trackingState, dt)`
- S-curve lean từ MediaPipe Pose shoulders/hips
- Spine twist theo head yaw
- Procedural breathing
- Idle sway

Tham khảo: `spine.md` toàn bộ + `character_controller.md §5`

**Done khi**: Nhân vật nghiêng người theo pose, thở nhìn thấy được

---

### Task 2.2: head_neck_controller.js

Nâng cấp từ code hiện tại trong `face_mesh.js`:
- Tách `neck` bone (35%) và `head` bone (65%)
- Spring damper cho neck follow-through
- Giữ face tracking hiện tại

Tham khảo: `head_neck.md` toàn bộ + `character_controller.md §6`

**Done khi**: Cổ di chuyển nhẹ trước đầu khi quay

---

## Phase 3 — Arms + Hands

**Mục tiêu**: Cánh tay IK theo wrist từ Pose, ngón tay theo Hand landmarks

### Task 3.1: arm_controller.js

- `solveTwoBoneIK(shoulderPos, upperLen, lowerLen, target)` — Law of Cosines
- `computeKneePlane / computeElbowPlane` — pole vector
- `applyArmIK(upperArm, lowerArm, ...)`
- Shoulder droop
- Idle target khi không có Pose

Tham khảo: `arm.md` toàn bộ + `character_controller.md §9`

**Done khi**: Tay theo vị trí cổ tay, khuỷu cong đúng chiều

---

### Task 3.2: hand_controller.js

- `computeFingerCurl(landmarks, fingerIndices)`
- `computeFingerSpread(landmarks, ...)`
- `applyCurlToFinger(finger, curl)`
- Preset poses (open, fist, idle)
- Thumb opposition

Tham khảo: `hand.md` toàn bộ + `character_controller.md §10`

**Done khi**: Ngón tay gấp/mở theo hand landmarks, idle pose đẹp

---

## Phase 4 — Legs + Feet

**Mục tiêu**: Chân IK theo ankle từ Pose, bàn chân không xuyên sàn

### Task 4.1: leg_controller.js

- `solveLegIK` — giống arm IK
- `snapFootToGround` — Raycaster
- `alignFootToGround` — căn theo ground normal
- `computeAnklePitch` — heel-to-toe roll
- Idle weight shift
- `safeKneeAngle` — tránh hyperextend

Tham khảo: `leg.md` toàn bộ + `character_controller.md §11`

**Done khi**: Chân đứng trên sàn, không nổi, không xuyên

---

## Phase 5 — Character Controller

**Mục tiêu**: Kết nối tất cả thành master loop

### Task 5.1: character_controller.js

- `updateCharacter(controller, trackingState, dt)` theo đúng thứ tự
- Khởi tạo tất cả sub-states
- Tích hợp vào Three.js render loop

Tham khảo: `character_controller.md` toàn bộ

**Done khi**: Toàn bộ body di chuyển đồng bộ, không có giật

---

## Phase 6 — Polish & Tuning

### 6.1 Secondary Motion
- Finger lag (từ `hand.md §11`)
- Head bob theo thở (từ `head_neck.md §5`)
- Shoulder lift theo thở (từ `spine.md §3b`)
- Height bobbing khi đi (từ `spine.md §7`)

### 6.2 Idle Animations
- Head micro-movement khi không tracking (từ `head_neck.md §7`)
- Weight shift hai chân (từ `leg.md §8`)
- Arm swing nhẹ theo thở (từ `arm.md §6`)

### 6.3 State Machine
- `IDLE` → chạy procedural
- `TRACKED` → driven bởi MediaPipe
- `LOOK_AT` → hướng về target cụ thể (NPC interaction)

---

## Thứ tự implement (khuyến nghị)

```
Week 1:
  □ Tìm/chuẩn bị model full body (Priority #1)
  □ Task 1.1: tracking_manager.js
  □ Task 1.2: character_setup.js
  □ Task 1.3: Tích hợp vào scene

Week 2:
  □ Task 2.1: spine_controller.js
  □ Task 2.2: head_neck_controller.js (refactor hiện tại)

Week 3:
  □ Task 3.1: arm_controller.js
  □ Task 3.2: hand_controller.js

Week 4:
  □ Task 4.1: leg_controller.js
  □ Task 5.1: character_controller.js

Week 5+:
  □ Phase 6: Polish + Tuning
```

---

## Checklist kiểm tra từng Phase

### Phase 0 ✓
- [ ] Model GLB có đầy đủ skeleton
- [ ] `listAllBones()` in ra đúng tên
- [ ] 52 morph targets có trên face mesh

### Phase 1 ✓
- [ ] `poseResult.worldLandmarks[0]` có 33 điểm
- [ ] `handResult.landmarks` tách đúng trái/phải
- [ ] `worldScale` hợp lý (x,y,z ~ 1-3)

### Phase 2 ✓
- [ ] Nhân vật nghiêng theo pose (spine lean)
- [ ] Cổ di chuyển trước đầu khi quay
- [ ] Breathing animation thấy rõ

### Phase 3 ✓
- [ ] Khuỷu tay không lật ngược
- [ ] Ngón tay gập theo hand tracking
- [ ] Idle pose tay tự nhiên khi không có tracking

### Phase 4 ✓
- [ ] Bàn chân không xuyên sàn
- [ ] Đầu gối không hyperextend
- [ ] Weight shift khi đứng yên

### Phase 5 ✓
- [ ] Không có giật giữa các modules
- [ ] dt spike không gây crash
- [ ] FPS >= 30 với full body

---

## Risk và cách xử lý

| Risk | Xác suất | Giải pháp |
|------|---------|-----------|
| Model không có đủ bones | Cao | Chạy `listAllBones()` sớm, remap tên nếu cần |
| MediaPipe Pose chỉ detect từ eo trở lên | Trung bình | Camera góc rộng hơn, hoặc dùng chỉ upper body |
| IK khuỷu/đầu gối lật | Cao | Luôn set pole vector, test với nhiều pose |
| worldScale sai → tay/chân offset lớn | Trung bình | Debug bằng cách visualize target positions |
| FPS quá thấp với 3 landmarkers | Thấp | Throttle Pose+Hand mỗi 2 frames (xem mediapipe_setup.md §7) |
| Face tracking bị ảnh hưởng khi thêm Pose | Thấp | 3 landmarkers độc lập, không ảnh hưởng nhau |

---

## Không thuộc scope này (để sau)

- HoloBox 4-view rendering pipeline
- Lip sync với full body (đã có `lip_sync.js`, cần tích hợp)
- Keyframe animation system (cho cinematic)
- Cloth/hair simulation
- Shadow casting cho hologram display
