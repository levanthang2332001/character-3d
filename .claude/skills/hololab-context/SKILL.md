---
name: hololab-context
description: Project context cho HoloLab WebGPU — mục tiêu sản phẩm, tech stack, file map, quy ước cốt lõi (L/R mirror, đơn vị, smoothing, hierarchy update order). Use this when the user asks "project là gì", "file X nằm đâu", "tech stack", "convention naming", "L/R nhầm hay không", hoặc khi bạn vừa mở repo lần đầu và chưa có context.
---

# HoloLab WebGPU — Context

## Mục tiêu

Pipeline render nhân vật 3D realtime cho hộp hologram **HoloBox**:

1. **Head & Face** (đã chạy): MediaPipe FaceLandmarker → 52 blendshape + head pose + eye look.
2. **Voice** (đã chạy): Azure Speech → viseme → mouth blendshape (lip sync).
3. **Full body** (đang xây): MediaPipe Pose + Hand → IK + procedural motion.
4. **Animation system** (đã chạy): Three.js AnimationMixer + Mixamo `.glb` clips.

## Tech stack

| Lớp | Lib |
|------|-----|
| 3D | `three` ^0.184 (WebGL hôm nay, dự kiến WebGPU) |
| Tracking | `@mediapipe/tasks-vision` |
| Voice | `microsoft-cognitiveservices-speech-sdk` |
| Server | Node + `ws` (static + speech proxy) |

Module: ES modules trong browser, CommonJS cho `server.js`. Không có build step.

## Cách chạy

```bash
npm install
npm start                         # node server.js, serve trên :3000
```

Cần `.env.local` với `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`.

## File map nhanh

```
script/
├── facecap.js                    # Three.js scene setup + render loop
├── face_mesh.js                  # FaceLandmarker → blendshape mapping
├── face_tracking_utils.js        # head pose / eye look math
├── eye_control.js                # eye bone rotation
├── lip_sync.js                   # viseme blending
├── webrtc_audio.js               # mic capture + Azure WS
├── chatgpt_assistant.js          # AI dialog
├── constants.js                  # blendshape names, eye landmarks
└── animation/
    ├── character.js              # AnimationMixer demo (idle/walk/punch/run)
    └── arm.js                    # gesture wave hand (procedural offset)

models/
├── remy/                         # Character.glb + Idle.glb + Walk.glb + Punching.glb
└── gltf/                         # samples (Soldier, facecap)

docs/                             # design docs — đọc theo docs/README.md
```

## Quy ước cốt lõi

### L/R mirror

| | "Left" |
|--|--------|
| Camera/MediaPipe | Trái người xem (= phải nhân vật) |
| Model/Three.js | Trái nhân vật (= phải người xem) |

→ Khi map MediaPipe → Model phải đảo L/R. Chi tiết: `docs/00-overview/glossary.md` §16.

### Đơn vị

- Góc: **radian**.
- Time: **giây** (dt). Spring damper sẽ blow up nếu nhận milliseconds.
- Pose `worldLandmarks`: **meters** thực tế.

### Smoothing α gợi ý

| | α |
|--|---|
| Morph target | 0.20–0.25 |
| Head pose | 0.30 |
| Eye | 0.35 |
| Wrist IK | 0.25 |
| Finger | 0.40 |

Secondary motion (cổ trễ, ngón trễ) → dùng spring damper, không lerp.

### Update order mỗi frame

```
Spine → Head/Neck → Eyes → Morph → Arm IK → Hand → Leg IK → Breathing
(gốc → ngọn, hierarchy parent trước con)
```

## Khi unsure → đọc đâu?

| Câu hỏi | Skill |
|---------|-------|
| AnimationMixer / clipAction / crossFade | `three-animation-mixer` |
| MediaPipe setup / parse / handedness | `mediapipe-tracking` |
| buildBoneMap / measureBoneLengths / worldScale | `character-rig` |
| spine lean / arm IK / foot ground | `body-controllers` |
| thêm gesture (wave / point / fist) | `procedural-gestures` |

Chi tiết bảng số / joint limits / formula → `docs/`.
