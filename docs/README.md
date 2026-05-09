# Docs — HoloLab WebGPU

> Kiến thức thiết kế cho pipeline render nhân vật 3D HoloBox. Đọc theo thứ tự nếu mới vào project, hoặc nhảy thẳng tới phần liên quan.

Cần overview ngắn để bắt tay làm ngay? → đọc `.claude/AGENT.md` ở root repo.
Cần tri thức load on-demand cho agent? → `.claude/skills/<name>/SKILL.md`.

---

## Đọc theo thứ tự (recommended)

| # | File | Khi đọc |
|---|------|---------|
| 1 | [00-overview/architecture.md](00-overview/architecture.md) | Đọc đầu tiên — kiến trúc tổng thể, hierarchy xương, nguồn input |
| 2 | [00-overview/glossary.md](00-overview/glossary.md) | Tra cứu thuật ngữ (head pose, blendshape, viseme, L/R…) |
| 3 | [00-overview/plan.md](00-overview/plan.md) | Roadmap 6 phase — đang ở đâu, làm gì tiếp |
| 4 | [01-tracking/mediapipe-setup.md](01-tracking/mediapipe-setup.md) | Cách chạy 3 landmarker đồng thời (Face / Pose / Hand) |
| 5 | [01-tracking/face-tracking.md](01-tracking/face-tracking.md) | Face mesh 478 landmark + 52 blendshape, head pose math |
| 6 | [02-rig/model-setup.md](02-rig/model-setup.md) | Load GLB, build bone map, đo length, worldScale, morph |
| 7 | [02-rig/animation-mixer.md](02-rig/animation-mixer.md) | Three.js AnimationMixer + Action + crossFade |
| 8 | [02-rig/animation-retargeting.md](02-rig/animation-retargeting.md) | Áp clip lên skeleton khác kích thước/tỉ lệ; Mixamo → custom rig |
| 9 | [02-rig/character-controller.md](02-rig/character-controller.md) | Master loop, data flow, gọi từng controller |
| 10 | [03-body-parts/head-neck.md](03-body-parts/head-neck.md) | Cổ + đầu, spring damper, follow-through |
| 11 | [03-body-parts/spine.md](03-body-parts/spine.md) | Cột sống S-curve, breathing, lean, twist |
| 12 | [03-body-parts/arm.md](03-body-parts/arm.md) | Two-bone IK, pole vector, shoulder droop |
| 13 | [03-body-parts/hand.md](03-body-parts/hand.md) | Curl + spread + thumb opposition + finger lag |
| 14 | [03-body-parts/leg.md](03-body-parts/leg.md) | Leg IK + ground snap + heel-to-toe roll |

---

## Cấu trúc folder

```
docs/
├── README.md                      ← bạn đang ở đây
│
├── 00-overview/                   Tổng quan dự án
│   ├── architecture.md            Kiến trúc + hierarchy
│   ├── glossary.md                Từ điển thuật ngữ
│   └── plan.md                    Roadmap 6 phase
│
├── 01-tracking/                   MediaPipe & camera input
│   ├── mediapipe-setup.md         Setup 3 landmarker
│   └── face-tracking.md           Face mesh + blendshape
│
├── 02-rig/                        Model + animation framework
│   ├── model-setup.md             GLB rig setup
│   ├── animation-mixer.md         Three.js mixer pattern
│   ├── animation-retargeting.md   Clip ↔ skeleton khác kích thước
│   └── character-controller.md    Master update loop
│
└── 03-body-parts/                 Controller chi tiết từng bộ phận
    ├── head-neck.md
    ├── spine.md
    ├── arm.md
    ├── hand.md
    └── leg.md
```

---

## Tra theo chủ đề

### Tracking & Input

- Setup MediaPipe → [01-tracking/mediapipe-setup.md](01-tracking/mediapipe-setup.md)
- Tính head pose từ landmarks → [01-tracking/face-tracking.md](01-tracking/face-tracking.md), `00-overview/glossary.md` §2
- Mirror correction (selfie cam) → `00-overview/glossary.md` §16
- Iris + eye look → `00-overview/glossary.md` §3-4
- 33 Pose landmark index → `00-overview/architecture.md`
- 21 Hand landmark index → `00-overview/architecture.md` + `03-body-parts/hand.md` §2

### Model & Rig

- Bone naming convention → [02-rig/model-setup.md](02-rig/model-setup.md) §1
- buildBoneMap / measureBoneLengths / worldScale → [02-rig/model-setup.md](02-rig/model-setup.md) §2-5
- Morph target setup → [02-rig/model-setup.md](02-rig/model-setup.md) §7
- Eye base quaternion → [02-rig/model-setup.md](02-rig/model-setup.md) §6
- Calibration neutral pose → [02-rig/model-setup.md](02-rig/model-setup.md) §9

### Animation system

- AnimationMixer + AnimationAction → [02-rig/animation-mixer.md](02-rig/animation-mixer.md)
- crossFade pattern + duration table → [02-rig/animation-mixer.md](02-rig/animation-mixer.md) §6
- Master loop update order → [02-rig/character-controller.md](02-rig/character-controller.md) §3
- Blend weights & manual blending → [02-rig/animation-mixer.md](02-rig/animation-mixer.md) §5
- Retarget clip người lớn → trẻ em / Mixamo → custom rig → [02-rig/animation-retargeting.md](02-rig/animation-retargeting.md)
- Strip root hips position (clip "trôi đi") → [02-rig/animation-retargeting.md §3](02-rig/animation-retargeting.md)
- `SkeletonUtils.retargetClip` API + caveat → [02-rig/animation-retargeting.md §6](02-rig/animation-retargeting.md)
- Mixamo bone naming map → [02-rig/animation-retargeting.md §7](02-rig/animation-retargeting.md)

### Body part math

- Spine S-curve weights → [03-body-parts/spine.md](03-body-parts/spine.md) §1
- Breathing 0.25Hz → [03-body-parts/spine.md](03-body-parts/spine.md) §3
- Spine twist khi đầu quay → [03-body-parts/spine.md](03-body-parts/spine.md) §4
- Neck spring damper → [03-body-parts/head-neck.md](03-body-parts/head-neck.md) §4
- Head/Neck phân phối 65/35 → [03-body-parts/head-neck.md](03-body-parts/head-neck.md) §2
- Two-bone IK (law of cosines) → [03-body-parts/arm.md](03-body-parts/arm.md) §1
- Pole vector → [03-body-parts/arm.md](03-body-parts/arm.md) §2, [03-body-parts/leg.md](03-body-parts/leg.md) §1
- Joint limits (radian) → mỗi `03-body-parts/*.md` mục §"Joint Constraints"
- Finger curl từ landmarks → [03-body-parts/hand.md](03-body-parts/hand.md) §4
- Foot ground raycast → [03-body-parts/leg.md](03-body-parts/leg.md) §5
- Knee hyperextend prevention → [03-body-parts/leg.md](03-body-parts/leg.md) §7

### Smoothing & secondary motion

- Lerp α reference table → `00-overview/glossary.md` §14
- Spring damper formula → [03-body-parts/head-neck.md](03-body-parts/head-neck.md) §4, [03-body-parts/hand.md](03-body-parts/hand.md) §11
- Idle micro-movements → [03-body-parts/head-neck.md](03-body-parts/head-neck.md) §7, [03-body-parts/spine.md](03-body-parts/spine.md) §5, [03-body-parts/leg.md](03-body-parts/leg.md) §8

---

## Mỗi doc có cấu trúc gì?

```
# Tiêu đề

> Tóm tắt 1-2 dòng + when-to-read

## Object definition  (nếu là body part)
## §1 §2 §3 ...        (concepts + formula + code)
## Lưu ý quan trọng    (bảng triệu chứng → nguyên nhân → fix)

────────────────────────────────────────
← Prev   |   Up: README   |   Next →
```

---

## Convention dùng trong docs

- **Đơn vị mặc định**: radian cho góc, mét cho world space, giây cho time.
- **Code block** kèm comment giải thích *why*, không narrate "// tăng biến".
- **Bảng triệu chứng** ở cuối: cột "Vấn đề | Nguyên nhân | Giải pháp".
- **L/R**: chú thích rõ là camera-space (MediaPipe) hay model-space (Three.js).
