# PLAN — Roadmap full body character

> Lộ trình 6 phase từ "head-only demo" tới "full body driven by MediaPipe Pose+Hand".

**When to read**: cần biết đang ở phase nào, làm gì tiếp, hoặc trước khi nhận task mới.

---

## Mục tiêu

Xây dựng nhân vật 3D full body cho HoloBox:

- **Đầu + mặt**: ✅ tracking + 52 blendshape + eye control + lip sync
- **Toàn thân**: driven bởi MediaPipe Pose + Hand
- **Procedural**: thở, idle sway, secondary motion
- **Render**: WebGL/Three.js (WebGPU sau)

---

## Tài liệu cần đọc cho từng phase

| File | Đọc khi |
|------|---------|
| [architecture.md](architecture.md) | Đầu tiên, mọi phase |
| [glossary.md](glossary.md) | Tra thuật ngữ bất cứ lúc nào |
| [../01-tracking/face-tracking.md](../01-tracking/face-tracking.md) | ✅ đã hoàn thành |
| [../01-tracking/mediapipe-setup.md](../01-tracking/mediapipe-setup.md) | **Phase 1** |
| [../02-rig/model-setup.md](../02-rig/model-setup.md) | **Phase 1** |
| [../02-rig/animation-mixer.md](../02-rig/animation-mixer.md) | **Phase 1.5** (animation framework) |
| [../03-body-parts/head-neck.md](../03-body-parts/head-neck.md) | **Phase 2** |
| [../03-body-parts/spine.md](../03-body-parts/spine.md) | **Phase 2** |
| [../03-body-parts/arm.md](../03-body-parts/arm.md) | **Phase 3** |
| [../03-body-parts/hand.md](../03-body-parts/hand.md) | **Phase 3** |
| [../03-body-parts/leg.md](../03-body-parts/leg.md) | **Phase 4** |
| [../02-rig/character-controller.md](../02-rig/character-controller.md) | **Phase 5** + xuyên suốt |

---

## Phase 0 — Prerequisites

### 0.1 Model full body

Cần model GLB:

- ✅ Skinned mesh + skeleton đầy đủ (Hips → Spine → Arms → Legs)
- ✅ 52 blendshape trên face mesh
- ✅ T-pose hoặc A-pose
- ✅ Bone naming theo VRM/Mixamo (xem [model-setup.md §1](../02-rig/model-setup.md))
- ✅ GLB binary

Nguồn gợi ý: Ready Player Me, Mixamo, VRoid Studio.

### 0.2 Cấu trúc file code

```
script/
  facecap.js                ✅ Three.js scene
  face_mesh.js              ✅ face tracking
  face_tracking_utils.js    ✅
  eye_control.js            ✅
  lip_sync.js               ✅
  constants.js              ✅
  animation/
    character.js            ✅ skeletal animation demo
    arm.js                  ✅ procedural gesture pattern

  [Phase 1 — chưa có]
  tracking_manager.js       quản lý 3 landmarker + trackingState
  character_setup.js        initCharacter(), buildBoneMap, worldScale

  [Phase 2]
  spine_controller.js
  head_neck_controller.js   (refactor từ face_mesh.js)

  [Phase 3]
  arm_controller.js         updateArm(), solveTwoBoneIK()
  hand_controller.js        updateHand(), computeFingerCurl()

  [Phase 4]
  leg_controller.js         updateLeg(), snapFootToGround()

  [Phase 5]
  character_controller.js   updateCharacter() master loop
```

---

## Phase 1 — Foundation

**Mục tiêu**: Load full body model + setup 3 landmarker + scene chạy.

### Task 1.1 — `tracking_manager.js`

```js
export async function initTrackingManager(video) { ... }
export function runTrackingFrame(video, timestamp) { ... }
export const trackingState = { ... };
```

Tham khảo: [mediapipe-setup.md](../01-tracking/mediapipe-setup.md).
**Done khi**: console log thấy `poseResult.worldLandmarks` có data.

### Task 1.2 — `character_setup.js`

```js
export async function initCharacter(glbPath) { ... }
```

Tham khảo: [model-setup.md](../02-rig/model-setup.md).
**Done khi**: `listAllBones(model)` in đủ tên, `boneLengths.leftUpperArmLength > 0`.

### Task 1.3 — Tích hợp vào `facecap.js`

Thêm `initTrackingManager` + `initCharacter` vào startup.
**Done khi**: scene load, model hiện, tracking chạy background.

---

## Phase 2 — Spine + Head/Neck

### Task 2.1 — `spine_controller.js`

- `updateSpine(controller, trackingState, dt)`
- S-curve lean từ shoulders/hips
- Spine twist theo head yaw
- Procedural breathing
- Idle sway

Tham khảo: [spine.md](../03-body-parts/spine.md) + [character-controller.md §5](../02-rig/character-controller.md).
**Done khi**: nhân vật nghiêng theo pose, breathing thấy được.

### Task 2.2 — `head_neck_controller.js`

Nâng cấp từ `face_mesh.js`:
- Tách `neck` (35%) + `head` (65%)
- Spring damper neck follow-through
- Giữ face tracking hiện tại

Tham khảo: [head-neck.md](../03-body-parts/head-neck.md) + [character-controller.md §6](../02-rig/character-controller.md).
**Done khi**: cổ di chuyển nhẹ trước đầu khi quay.

---

## Phase 3 — Arms + Hands

### Task 3.1 — `arm_controller.js`

- `solveTwoBoneIK(...)` — Law of Cosines
- `computeElbowPlane` — pole vector
- `applyArmIK(...)`
- Shoulder droop
- Idle target khi không có Pose

Tham khảo: [arm.md](../03-body-parts/arm.md) + [character-controller.md §9](../02-rig/character-controller.md).
**Done khi**: tay theo wrist, khuỷu cong đúng chiều.

### Task 3.2 — `hand_controller.js`

- `computeFingerCurl(...)`
- `computeFingerSpread(...)`
- `applyCurlToFinger(...)`
- Preset poses (open / fist / idle)
- Thumb opposition

Tham khảo: [hand.md](../03-body-parts/hand.md) + [character-controller.md §10](../02-rig/character-controller.md).
**Done khi**: ngón gấp/mở theo hand landmarks, idle pose tự nhiên.

---

## Phase 4 — Legs + Feet

### Task 4.1 — `leg_controller.js`

- `solveLegIK` — same as arm
- `snapFootToGround` — Raycaster
- `alignFootToGround` — theo ground normal
- `computeAnklePitch` — heel-to-toe roll
- Idle weight shift
- `safeKneeAngle` — tránh hyperextend

Tham khảo: [leg.md](../03-body-parts/leg.md) + [character-controller.md §11](../02-rig/character-controller.md).
**Done khi**: chân đứng trên sàn, không nổi/xuyên.

---

## Phase 5 — Character Controller

### Task 5.1 — `character_controller.js`

- `updateCharacter(controller, trackingState, dt)` đúng thứ tự
- Khởi tạo tất cả sub-state
- Tích hợp Three.js render loop

Tham khảo: [character-controller.md](../02-rig/character-controller.md).
**Done khi**: full body đồng bộ, không giật.

---

## Phase 6 — Polish & Tuning

### 6.1 Secondary motion

- Finger lag (`hand.md §11`)
- Head bob theo thở (`head-neck.md §5`)
- Shoulder lift theo thở (`spine.md §3b`)
- Height bobbing khi đi (`spine.md §7`)

### 6.2 Idle animations

- Head micro-movement (`head-neck.md §7`)
- Weight shift hai chân (`leg.md §8`)
- Arm swing theo thở (`arm.md §6`)

### 6.3 State machine

- `IDLE` → procedural
- `TRACKED` → MediaPipe driven
- `LOOK_AT` → hướng về target NPC

---

## Thứ tự implement gợi ý

```
Week 1:  Model full body + Task 1.1 + 1.2 + 1.3
Week 2:  Task 2.1 + 2.2 (refactor head/neck)
Week 3:  Task 3.1 + 3.2
Week 4:  Task 4.1 + 5.1
Week 5+: Polish + Tuning
```

---

## Checklist từng phase

### Phase 0 ✓
- [ ] Model GLB có đầy đủ skeleton
- [ ] `listAllBones()` in đúng tên
- [ ] 52 morph target trên face mesh

### Phase 1 ✓
- [ ] `poseResult.worldLandmarks[0]` có 33 điểm
- [ ] `handResult.landmarks` tách đúng trái/phải (mirror)
- [ ] `worldScale` hợp lý (x,y,z ~ 1–3)

### Phase 2 ✓
- [ ] Nhân vật nghiêng theo pose (spine lean)
- [ ] Cổ di chuyển trước đầu khi quay
- [ ] Breathing thấy rõ

### Phase 3 ✓
- [ ] Khuỷu tay không lật ngược
- [ ] Ngón gập theo hand tracking
- [ ] Idle pose tay tự nhiên khi không tracking

### Phase 4 ✓
- [ ] Bàn chân không xuyên sàn
- [ ] Đầu gối không hyperextend
- [ ] Weight shift khi đứng yên

### Phase 5 ✓
- [ ] Không có giật giữa các module
- [ ] dt spike không gây crash
- [ ] FPS ≥ 30 với full body

---

## Risk & cách xử

| Risk | Xác suất | Giải pháp |
|------|---------|-----------|
| Model không đủ bones | Cao | Chạy `listAllBones()` sớm, remap tên |
| Pose chỉ detect từ eo lên | Trung bình | Camera góc rộng / chỉ upper body |
| IK khuỷu/đầu gối lật | Cao | Luôn set pole vector, test đa pose |
| worldScale sai → tay/chân offset | Trung bình | Visualize target positions |
| FPS thấp với 3 landmarker | Thấp | Throttle Pose+Hand mỗi 2 frame ([mediapipe-setup.md §7](../01-tracking/mediapipe-setup.md)) |
| Face tracking bị ảnh hưởng khi thêm Pose | Thấp | 3 landmarker độc lập, không ảnh hưởng nhau |

---

## Không thuộc scope phase này

- HoloBox 4-view rendering pipeline
- Lip sync với full body (đã có `lip_sync.js`, cần tích hợp lại)
- Keyframe animation system cho cinematic
- Cloth / hair simulation
- Shadow casting cho hologram display

---

← Prev: [glossary.md](glossary.md) | **Up**: [README](../README.md) | Next: [../01-tracking/mediapipe-setup.md →](../01-tracking/mediapipe-setup.md)
