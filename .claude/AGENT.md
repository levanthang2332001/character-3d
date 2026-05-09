# AGENT.md — HoloLab WebGPU

> File này là **brief đầu tiên** mọi agent (Claude/Cursor/Codex…) nên đọc khi mở repo.
> Mục tiêu: cung cấp đủ context để agent làm việc có hiệu quả ngay từ câu hỏi đầu.

---

## 1. Project là gì?

**HoloLab WebGPU** là pipeline render nhân vật 3D cho hộp hologram **HoloBox**:

- Đầu/mặt: tracking webcam realtime (MediaPipe FaceLandmarker → 52 blendshapes + head pose).
- Toàn thân: MediaPipe Pose + Hand → driven IK + procedural motion.
- Render: Three.js (WebGL hôm nay, dự kiến WebGPU sau).
- Voice: Microsoft Azure Speech SDK (lip sync via viseme).

Repo đang ở giai đoạn từ "head-only demo" → "full body rig". Phase hiện tại theo `docs/00-overview/plan.md`.

---

## 2. Cách chạy

```bash
npm install              # one-time
npm start                # node server.js — phục vụ static + Azure Speech proxy
# Mở http://localhost:3000
```

Yêu cầu môi trường:

- Node ≥ 18
- File `.env.local` ở root chứa `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` (đã có sẵn cho dev).
- Webcam quyền truy cập trong trình duyệt.

Không có lint / test / build step — chạy thẳng từ source.

---

## 3. Tech stack

| Lớp | Lib / file |
|------|-----------|
| 3D / render | `three` ^0.184 (`three/addons/...`) |
| Tracking | `@mediapipe/tasks-vision` |
| Voice | `microsoft-cognitiveservices-speech-sdk` |
| Server | `node` + `ws` (WebSocket cho speech relay) |
| Module system | ES modules trong browser, CommonJS cho `server.js` |

---

## 4. File map

```
webgpu/
├── server.js                    # static server + speech proxy
├── facecap_animation.html       # demo head + body animation (entry hiện tại)
├── facecap_emotions.html        # demo head + emotion presets
├── main.css
├── package.json
│
├── script/
│   ├── facecap.js               # Three.js scene + face mesh load + render loop
│   ├── face_mesh.js             # FaceLandmarker setup + blendshape mapping
│   ├── face_tracking_utils.js   # head pose / eye look helpers
│   ├── eye_control.js           # eye bone rotation
│   ├── lip_sync.js              # viseme blending từ audio
│   ├── webrtc_audio.js          # mic capture
│   ├── chatgpt_assistant.js     # AI dialog
│   ├── constants.js             # blendshape names, eye landmarks, …
│   └── animation/
│       ├── character.js         # full-body skeletal demo (Mixer + crossFade)
│       ├── arm.js               # right-hand "wave" gesture (procedural offset)
│       └── demo.html            # standalone Three.js example reference
│
├── models/
│   ├── remy/                    # Mixamo character + Idle/Walk/Punch.glb
│   └── gltf/                    # face / soldier samples
│
├── docs/                        # design docs (đọc theo docs/README.md)
└── .claude/
    ├── AGENT.md                 # ← bạn đang đọc
    └── skills/                  # tri-thức chuyên đề (load on demand)
```

Chi tiết từng vùng → đọc skill tương ứng dưới đây.

---

## 5. Quy ước cốt lõi (đừng làm sai)

### 5.1 L/R mirror

| Không gian | "Left" nghĩa là |
|------------|-----------------|
| Camera / MediaPipe | Trái của người xem (= phải của nhân vật) |
| Model / Three.js  | Trái của nhân vật (= phải của người xem) |

Khi map MediaPipe → Model phải **đảo L/R**. Chi tiết: `docs/00-overview/glossary.md` §16.

### 5.2 Đơn vị

- Góc: **radian** (luôn). Joint constraints viết dưới dạng radian.
- Thời gian: **giây** trong delta time `dt`. KHÔNG bao giờ truyền milliseconds vào spring/lerp.
- Tọa độ MediaPipe Pose `worldLandmarks`: **meters thực tế** (không cần normalize).

### 5.3 Smoothing

Mặc định: lerp với α nhỏ thay vì set thẳng input thô.

| Loại tín hiệu | α gợi ý |
|---------------|---------|
| Morph target (blendshape) | 0.20–0.25 |
| Head pose yaw/pitch | 0.30 |
| Eye rotation | 0.35 |
| Wrist IK target | 0.25 |
| Finger curl/spread | 0.40 |

Secondary motion (cổ, ngón tay trễ) → **spring damper**, không lerp.

### 5.4 Hierarchy update order mỗi frame

```
1. Spine (gốc → ngọn: Hips → Spine* → UpperChest)
2. Head/Neck
3. Eyes
4. Morph targets
5. Arm IK (left, right)
6. Hand fingers
7. Leg IK
8. Procedural breathing (cộng vào cuối)
```

### 5.5 Khi gesture chồng lên Mixer

Pattern: lưu `baseQuaternion` từ pose hiện tại trước, rồi `quaternion.multiply(offset)` — không set rotation trực tiếp.
Xem skill `procedural-gestures`.

---

## 6. Khi user hỏi gì → mở skill nào?

Skills nằm ở `.claude/skills/<name>/SKILL.md`. Trong Cursor/Claude Code chúng tự load khi description match — nhưng có thể đọc thủ công bất cứ lúc nào.

| Câu hỏi điển hình | Skill |
|-------------------|-------|
| "Project là gì? File này nằm đâu?" | `hololab-context` |
| "Làm sao thêm clip animation mới? Mixer/crossFade?" | `three-animation-mixer` |
| "Animation người lớn add vô trẻ em bị lệch? Retarget?" | `three-animation-mixer` + `docs/02-rig/animation-retargeting.md` |
| "Setup Pose/Hand landmarker? Parse handedness?" | `mediapipe-tracking` |
| "Tìm bone trong GLB? Tính worldScale? Đo length?" | `character-rig` |
| "Spine lean? Head spring? Arm IK? Foot ground?" | `body-controllers` |
| "Thêm gesture wave / point / fist? Code arm.js" | `procedural-gestures` |

---

## 7. Docs ở đâu?

Toàn bộ tri thức chi tiết, có ví dụ code và bảng joint limits, ở `docs/`:

```
docs/
├── README.md                    # master index — đọc đầu tiên
├── 00-overview/                 # kiến trúc, glossary, roadmap
├── 01-tracking/                 # MediaPipe + face tracking
├── 02-rig/                      # model setup, character controller, animation
└── 03-body-parts/               # head-neck, spine, arm, hand, leg
```

Skills tóm tắt + trỏ về docs cho bảng số chi tiết.

---

## 8. Coding rules

- **Ngôn ngữ**: ES modules, JS thuần (không TypeScript trong repo).
- **Style**: 2 space indent, trailing comma, double quotes.
- **Không thêm dependency mới** trừ khi user yêu cầu.
- **Không tạo file mới** nếu có thể edit file có sẵn.
- **Comment**: chỉ viết comment giải thích *vì sao*, không viết "// tăng biến đếm".
- **L/R mirror**: nghi ngờ thì đọc `docs/00-overview/glossary.md` §16 trước khi đoán.
- **dt**: clamp ở Math.min(dt, 0.05) khi tab có thể bị ẩn — tránh spring blow up.
- **Set rotation**: ưu tiên `quaternion.multiply(offset)` trên base quaternion thay vì gán Euler trực tiếp khi đã có animation chạy.

---

## 9. Trạng thái hiện tại (May 2026)

| Hoàn thành | Đang làm | Chưa |
|-----------|----------|------|
| Face tracking + 52 blendshape | character.js skeleton demo (idle/walk/punch + wave gesture) | Pose + Hand landmarker chạy chung |
| Eye control bone | arm.js procedural gesture pattern | Spine/Arm/Leg IK controllers |
| Lip sync viseme | | Foot ground contact |
| Mixamo .glb load + AnimationMixer | | Full body integration |

Plan chi tiết: `docs/00-overview/plan.md`.

---

## 10. Khi không chắc — đọc đâu?

1. Skill tương ứng (mục 6).
2. Docs chi tiết (mục 7).
3. Source code: `script/animation/character.js` là reference cho Mixer pattern; `script/face_mesh.js` cho tracking pattern.
4. Hỏi user — đừng đoán convention bone/landmark.
