# Glossary — Từ điển thuật ngữ

> Tra cứu mọi keyword dùng trong codebase: tracking khuôn mặt (MediaPipe), morph target, bone, cảm xúc, lip sync, smoothing, L/R convention.

**When to read**: gặp keyword không hiểu, hoặc cần kiểm tra convention naming/đơn vị/range trước khi code.

---

## Mục lục

1. [Hệ tọa độ](#1-hệ-tọa-độ)
2. [Head Pose — Góc đầu](#2-head-pose--góc-đầu)
3. [Eye — Mắt](#3-eye--mắt)
4. [Iris — Tròng mắt](#4-iris--tròng-mắt)
5. [Brow — Lông mày](#5-brow--lông-mày)
6. [Cheek — Má](#6-cheek--má)
7. [Nose — Mũi](#7-nose--mũi)
8. [Jaw — Hàm](#8-jaw--hàm)
9. [Mouth — Miệng](#9-mouth--miệng)
10. [Viseme — Hình miệng](#10-viseme--hình-miệng)
11. [Emotion — Cảm xúc](#11-emotion--cảm-xúc)
12. [Bone & Quaternion](#12-bone--quaternion)
13. [Blendshape / Morph Target](#13-blendshape--morph-target)
14. [Smoothing — Làm mượt](#14-smoothing--làm-mượt)
15. [Landmark — Điểm mốc](#15-landmark--điểm-mốc)
16. [Quy ước L/R — Trái/Phải](#16-quy-ước-lr--tráiphải)

---

## 1. Hệ tọa độ

### MediaPipe Landmark Space

```
(0,0) ──────────────► x  (tăng sang phải)
  │
  ▼
  y  (tăng xuống dưới)
```

- Tất cả tọa độ normalize `[0, 1]` theo kích thước video.
- **Mirror**: Camera selfie đảo ngang → `x_thực = 1 - x_landmark` khi vẽ.

### Three.js World Space

```
      +Y (lên)
       │
       └────► +X (phải)
      /
   +Z (ra phía trước / phía camera)
```

- Góc Euler cho head: dùng thứ tự `"YXZ"` (yaw → pitch → roll) tránh gimbal lock.
- **Pitch dương** = mũi xoay xuống (nhìn xuống).
- **Yaw dương** = quay sang phải (nhân vật).

---

## 2. Head Pose — Góc đầu

| Keyword | Tên khác | Chuyển động | Range |
|---------|----------|-------------|-------|
| `pitch` | tilt | Gật / ngẩng | `[-0.55, +0.45]` rad |
| `yaw`   | quay ngang | Lắc trái/phải | `[-0.70, +0.70]` rad |
| `roll`  | nghiêng | Nghiêng đầu | `[-0.30, +0.30]` rad |

```
  pitch (+)      yaw (+)         roll (+)
  = nhìn xuống  = quay phải     = nghiêng phải
      ↓              →               ↗
```

### Cách tính từ landmarks

```
eyeDistance = khoảng cách 2 tâm mắt  (scale reference)

yaw   = (nose.x - eyeCenter.x) / (eyeDistance × 0.8)
pitch = -(nose.y - eyeCenter.y) / (eyeDistance × 2.5)
roll  = atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) × 0.5
```

`positionYaw` = bias bù khi mặt không ở giữa frame: `(0.5 - faceCenter.x) × 1.35`.

---

## 3. Eye — Mắt

### Mở/nhắm

| Keyword | Mô tả |
|---------|-------|
| `eyeBlink_L` / `eyeBlink_R` | Nhắm hoàn toàn (0=mở, 1=nhắm kín) |
| `eyeSquint_L` / `eyeSquint_R` | Nheo (mí dưới kéo lên) — angry/cười |
| `eyeWide_L` / `eyeWide_R` | Mở to (mí trên kéo lên) — surprise/fear |

### Hướng nhìn

| Keyword | Hướng |
|---------|-------|
| `eyeLookUp_L`/`R` | Nhìn lên |
| `eyeLookDown_L`/`R` | Nhìn xuống |
| `eyeLookIn_L`/`R` | Nhìn vào trong (sống mũi) |
| `eyeLookOut_L`/`R` | Nhìn ra ngoài (thái dương) |

> `In` / `Out` phụ thuộc bên: mắt trái Out = nhìn sang trái; mắt phải Out = nhìn sang phải.

### EyeLookWeights (từ `createEyeLookFromLandmarks()`)

```js
{
  up: 0..1, down: 0..1, inward: 0..1, outward: 0..1,
  rotationPitch: float,    // rad cho eye bone
  rotationYaw:   float,
}
```

### Giới hạn xoay mắt (`eye_control.js`)

```
EYE_PITCH_LIMIT = 0.28 rad ≈ 16°
EYE_YAW_LIMIT   = 0.60 rad ≈ 34°
```

---

## 4. Iris — Tròng mắt

5 điểm/mắt: 468–472 (right), 473–477 (left).

```
irisCenter = average(5 iris points)
eyeCenter  = midpoint(inner corner, outer corner)

horizontal = (irisCenter.x - eyeCenter.x) / (eyeWidth  × 0.35)
vertical   = (irisCenter.y - eyeCenter.y) / (eyeHeight × 0.35)
```

Denominator `0.35` = iris dịch 35% kích thước mắt thì đạt ±1.

`headGazeBias`: cộng nhẹ theo head yaw cho mắt nhìn tự nhiên: `rotationYaw += headEuler.yaw × 0.30`.

---

## 5. Brow — Lông mày

| Keyword | Mô tả |
|---------|-------|
| `browDown_L`/`R` | Cau xuống — angry, focus |
| `browInnerUp` | Phần giữa kéo lên — worried, sad |
| `browOuterUp_L`/`R` | Phần ngoài kéo lên — surprise |

`BROW_MORPH_SCALE` — giảm bớt khi tracking để không quá lố:

```js
browInnerUp:    0.25
browOuterUp_*:  0.30
browDown_*:     0.50
```

---

## 6. Cheek — Má

- `cheekPuff` — má phồng 2 bên.
- `cheekPuff_L` / `cheekPuff_R` — phồng từng bên (emotion presets).

---

## 7. Nose — Mũi

- `noseSneer_L` / `noseSneer_R` — nhăn mũi (disgust).
- Landmark `1` = đầu mũi, dùng làm reference cho head pose.

---

## 8. Jaw — Hàm

- `jawOpen` — `0` ngậm, `1` há hết. Quan trọng nhất cho lip sync.

---

## 9. Mouth — Miệng

### Hình dạng môi

| Keyword | Mô tả | Dùng cho |
|---------|-------|----------|
| `mouthSmile_L`/`R` | Khóe lên (cười) | smile, E, I |
| `mouthFrown_L`/`R` | Khóe xuống (mếu) | sad |
| `mouthFunnel` | Tròn như thổi sáo | O, AW |
| `mouthPucker` | Chu ra (hôn) | U, O |
| `mouthStretch_L`/`R` | Kéo rộng ngang | E, I |
| `mouthPress_L`/`R` | Ép chặt | M, B, P |

### Chuyển động môi

| Keyword | Mô tả |
|---------|-------|
| `mouthUpperUp_L`/`R` | Môi trên kéo lên |
| `mouthLowerDown_L`/`R` | Môi dưới kéo xuống |
| `mouthRollUpper`/`Lower` | Cuộn vào trong |
| `mouthShrugUpper`/`Lower` | Nhún |
| `mouthLeft` / `mouthRight` | Dịch ngang |

---

## 10. Viseme — Hình miệng theo âm

| Viseme | Âm | jawOpen | Đặc trưng |
|--------|-----|---------|-----------|
| `rest` | im lặng | 0.02 | Khép nhẹ |
| `A` | a, ă, â | 0.82 | Mở rộng nhất |
| `AW` | oa, oe | 0.56 | Tròn + mở vừa |
| `E` | e, ê | 0.22 | Kéo ngang (smile) |
| `I` | i, y | 0.18 | Kéo ngang hẹp |
| `O` | o, ô, ơ | 0.44 | Tròn vừa (funnel) |
| `U` | u, ư | 0.18 | Chu nhiều (pucker) |
| `M` | m, b, p | 0.04 | Khép + ép |

Lip sync controller chọn viseme gần nhất với âm đang phát, lerp giữa các viseme.

---

## 11. Emotion — Cảm xúc

| Emotion | Morph chính |
|---------|-------------|
| `neutral` | Tất cả = 0 |
| `smile` | mouthSmile, browInnerUp, cheekPuff |
| `angry` | browDown, eyeSquint, mouthFunnel |
| `sad` | browInnerUp, mouthFrown |
| `surprise` | browOuterUp, eyeWide, jawOpen |
| `disgust` | noseSneer, mouthUpperUp, mouthLowerDown |
| `fear` | browOuterUp, eyeWide, jawOpen, mouthFunnel |

---

## 12. Bone & Quaternion

### Bones điều khiển mắt

```
Scene
 └── grp_eyeLeft    (THREE.Group)  ← xoay bằng quaternion
 └── grp_eyeRight
```

`baseQuaternion` = quaternion trung tính của mắt lúc load model.
Khi xoay: `eyeGroup.quaternion = deltaQ × baseQ` (tránh drift).

### Bones đầu/cổ

```
UpperChest
 └── Neck      ← nhận 35% rotation
      └── Head ← nhận 65% rotation
```

### Euler order

- Head bone: `"YXZ"` (yaw trước, pitch sau, roll cuối) — tránh gimbal lock.
- Eye bone: `"XYZ"`.

---

## 13. Blendshape / Morph Target

Hai thuật ngữ **đồng nghĩa**:

| Thuật ngữ | Nguồn gốc | Dùng ở đâu |
|-----------|-----------|------------|
| Blendshape | Phần mềm 3D (Blender, Maya) | Tên gốc trong GLTF |
| Morph Target | Three.js API | Code JS (`morphTargetInfluences`) |

**BLENDSHAPE_MAP** — bảng convert tên do mirror:

```
MediaPipe name    →    Model morph target name
eyeBlinkLeft      →    eyeBlink_R       (đảo L/R)
browDownLeft      →    browDown_R
mouthSmileLeft    →    mouthSmile_R
```

`updateMorphTargetSmooth()` — set có lerp built-in để không giật.

---

## 14. Smoothing — Làm mượt

### Lerp (EMA)

```
output = lerp(previous, target, α)
       = previous + α × (target - previous)
```

| α | Hiệu ứng | Dùng cho |
|---|----------|---------|
| 0.20–0.25 | Mượt mạnh | Morph blendshape |
| 0.30 | Cân bằng | Head pose |
| 0.35 | Phản hồi nhanh | Eye bone |
| 0.40 | Khá nhanh | Finger curl |
| 1.00 | No smooth | (debug) |

### Bảng α thực tế trong project

| Thành phần | α | File |
|------------|---|------|
| Head yaw / pitch | 0.30 | `face_tracking_utils.js` |
| Head roll | 0.25 | `face_tracking_utils.js` |
| Eye rotation | 0.35 | `face_tracking_utils.js` |
| Eye blendshape | 0.25 | `face_tracking_utils.js` |
| Morph target chung | ~0.15–0.25 | `face_mesh.js` |

### `eyeNeutral` — hiệu chỉnh trung tính

15 frame đầu tracking → tính offset "nhìn thẳng":

```js
state.eyeNeutral = { leftPitch, leftYaw, rightPitch, rightYaw };
```

Frame sau trừ neutral offset → mắt không lệch khi user nhìn thẳng.

---

## 15. Landmark — Điểm mốc

MediaPipe Face Mesh: 478 = 468 mesh + 10 iris.

### Điểm quan trọng

| Index | Tên | Dùng cho |
|-------|-----|----------|
| 1 | Nose tip | Head pose yaw/pitch |
| 33 | Right eye inner | Eye tracking |
| 133 | Right eye outer | Eye tracking |
| 145 | Right eye lower lid | Eye height |
| 159 | Right eye upper lid | Eye height |
| 263 | Left eye outer | Eye tracking |
| 362 | Left eye inner | Eye tracking |
| 374 | Left eye lower lid | Eye height |
| 386 | Left eye upper lid | Eye height |
| 468–472 | Right iris (5 pts) | Iris direction |
| 473–477 | Left iris (5 pts) | Iris direction |

### `EYE_LANDMARKS`

```js
{
  right: { inner: 33,  outer: 133, upper: 159, lower: 145, iris: [468..472] },
  left:  { inner: 362, outer: 263, upper: 386, lower: 374, iris: [473..477] },
}
```

---

## 16. Quy ước L/R — Trái/Phải

> ⚠️ **Dễ nhầm nhất trong codebase.**

| Không gian | "Left" nghĩa là |
|------------|-----------------|
| **Camera / MediaPipe** | Trái của người xem (= phải của nhân vật) |
| **Model / Three.js** | Trái của nhân vật (= phải của người xem) |

**Kết quả**: khi map MediaPipe → Model phải đảo L/R:

```
MediaPipe: eyeBlinkLeft   →  Model: eyeBlink_R
MediaPipe: browDownLeft   →  Model: browDown_R
MediaPipe: mouthSmileLeft →  Model: mouthSmile_R
MediaPipe handedness "Left" → state.rightHandLandmarks  ← swap
```

**Ký hiệu trong code**:
- `_L` = trái của **model** (= phải trong camera selfie)
- `_R` = phải của **model** (= trái trong camera selfie)
- `Left` (không gạch dưới) = MediaPipe convention (góc camera)

---

## Quick Reference — Nhóm keyword theo vùng

```
MẮT (Eye)
├── Mở/Nhắm:    eyeBlink, eyeSquint, eyeWide
├── Hướng nhìn: eyeLookUp/Down/In/Out
└── Iris:       grp_eyeLeft/Right, rotationPitch/Yaw

LÔNG MÀY:  browDown, browInnerUp, browOuterUp
MÁ / MŨI:  cheekPuff, noseSneer
HÀM:       jawOpen
MIỆNG:
  ├── Hình:    mouthSmile, mouthFrown, mouthFunnel, mouthPucker, mouthStretch
  ├── Chuyển:  mouthUpperUp, mouthLowerDown, mouthRollUpper/Lower
  └── Vị trí:  mouthLeft, mouthRight, mouthPress

ĐẦU/CỔ:    pitch, yaw, roll → Neck (35%) + Head (65%)
```

---

← Prev: [architecture.md](architecture.md) | **Up**: [README](../README.md) | Next: [plan.md →](plan.md)
