# Character Keywords — Từ điển thuật ngữ nhân vật 3D

Tài liệu này giải thích **tất cả từ khóa** dùng trong hệ thống điều khiển nhân vật, từ
tracking khuôn mặt (MediaPipe) đến morph target, bone, cảm xúc, và lip sync.

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
       │
       └────► +X (phải)
      /
     /
   +Z (ra phía trước / phía camera)
```

- Góc Euler cho head: dùng thứ tự `"YXZ"` (yaw → pitch → roll).
- **Pitch dương** = mũi xoay xuống (nhìn xuống).
- **Yaw dương** = quay sang phải (nhân vật).

---

## 2. Head Pose — Góc đầu

Ba góc Euler mô tả hướng đầu trong không gian 3D.

| Từ khóa | Tên khác | Chuyển động | Range thường dùng |
|---------|----------|-------------|-------------------|
| `pitch` | tilt lên/xuống | Gật đầu / ngẩng đầu | `[-0.55, +0.45]` rad |
| `yaw`   | quay ngang | Lắc đầu trái/phải | `[-0.70, +0.70]` rad |
| `roll`  | nghiêng | Nghiêng đầu sang vai | `[-0.30, +0.30]` rad |

```
  pitch (+)      yaw (+)         roll (+)
  = nhìn xuống  = quay phải     = nghiêng phải
      ↓              →               ↗
```

**Cách tính từ landmarks:**

```
eyeDistance = khoảng cách 2 tâm mắt  (scale reference)

yaw   = (nose.x - eyeCenter.x) / (eyeDistance × 0.8)
pitch = -(nose.y - eyeCenter.y) / (eyeDistance × 2.5)
roll  = atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) × 0.5
```

**positionYaw** — bias bù thêm khi khuôn mặt không ở giữa frame:
```
positionYaw = (0.5 - faceCenter.x) × 1.35
```

---

## 3. Eye — Mắt

### Morph target mở/nhắm mắt

| Keyword | Mô tả |
|---------|-------|
| `eyeBlink_L` / `eyeBlink_R` | Nhắm mắt hoàn toàn (0 = mở, 1 = nhắm kín) |
| `eyeSquint_L` / `eyeSquint_R` | Nheo mắt (mí dưới kéo lên nhẹ) — dùng khi tức giận, cười |
| `eyeWide_L` / `eyeWide_R` | Mở mắt to (mí trên kéo lên) — dùng khi ngạc nhiên, sợ |

### Morph target hướng nhìn (Eye Look)

Bốn hướng nhìn cho mỗi mắt, giá trị `[0, 1]`:

| Keyword | Hướng |
|---------|-------|
| `eyeLookUp_L` / `eyeLookUp_R` | Nhìn lên |
| `eyeLookDown_L` / `eyeLookDown_R` | Nhìn xuống |
| `eyeLookIn_L` / `eyeLookIn_R` | Nhìn vào trong (hướng sống mũi) |
| `eyeLookOut_L` / `eyeLookOut_R` | Nhìn ra ngoài (hướng thái dương) |

> **Lưu ý:** `In` và `Out` phụ thuộc vào bên mắt.
> - Mắt trái `Out` = nhìn sang trái (khỏi mũi).
> - Mắt phải `Out` = nhìn sang phải.

### EyeLookWeights object

Kết quả trả về từ `createEyeLookFromLandmarks()`:

```js
{
  up:            0..1,   // weight nhìn lên
  down:          0..1,   // weight nhìn xuống
  inward:        0..1,   // weight nhìn vào sống mũi
  outward:       0..1,   // weight nhìn ra thái dương
  rotationPitch: float,  // góc xoay dọc cho eye bone (radian)
  rotationYaw:   float,  // góc xoay ngang cho eye bone (radian)
}
```

### Giới hạn xoay mắt (eye_control.js)

```
EYE_PITCH_LIMIT = 0.28 rad  ≈ 16°  (lên/xuống)
EYE_YAW_LIMIT   = 0.60 rad  ≈ 34°  (trái/phải)
```

---

## 4. Iris — Tròng mắt

**Iris** = vùng tròng đen + tròng màu của mắt. MediaPipe track 5 điểm per mắt:

| Index | Vị trí |
|-------|--------|
| 468–472 | Iris mắt phải (right): center + 4 viền |
| 473–477 | Iris mắt trái (left): center + 4 viền |

**Cách tính hướng nhìn từ iris:**

```
irisCenter = average(5 iris points)
eyeCenter  = midpoint(inner corner, outer corner)

horizontal = (irisCenter.x - eyeCenter.x) / (eyeWidth  × 0.35)
vertical   = (irisCenter.y - eyeCenter.y) / (eyeHeight × 0.35)
```

- `horizontal > 0` = iris dịch sang phải (camera coords) = nhìn phải
- `vertical > 0`   = iris dịch xuống (screen y↓) = nhìn xuống
- Denominator `0.35` → iris dịch 35% kích thước mắt = đạt ±1 (nhạy)

**headGazeBias** — offset nhỏ cộng thêm theo hướng đầu để trông tự nhiên:
```
rotationYaw += headEuler.yaw × 0.30
```

---

## 5. Brow — Lông mày

| Keyword | Mô tả |
|---------|-------|
| `browDown_L` / `browDown_R` | Lông mày cau xuống (tức giận, tập trung) |
| `browInnerUp` | Phần giữa lông mày kéo lên (lo lắng, buồn) — 2 bên đồng thời |
| `browOuterUp_L` / `browOuterUp_R` | Phần ngoài lông mày kéo lên (ngạc nhiên) |

**BROW_MORPH_SCALE** — hệ số giảm lông mày khi tracking camera:

```js
browInnerUp:    0.25  // giảm nhiều nhất — dễ bị trigger khi nhìn lên
browOuterUp_*:  0.30
browDown_*:     0.50  // giảm ít hơn
```

> **Lý do:** Khi người dùng "trợn mắt" nhìn lên, cơ chân mày tự nhiên co nhẹ.
> MediaPipe detect và activate browInnerUp. Scale xuống để mắt mới là điểm nhấn.

---

## 6. Cheek — Má

| Keyword | Mô tả |
|---------|-------|
| `cheekPuff` | Má phồng (hai bên đồng thời) |
| `cheekPuff_L` / `cheekPuff_R` | Má phồng từng bên (dùng trong emotion presets) |

---

## 7. Nose — Mũi

| Keyword | Mô tả |
|---------|-------|
| `noseSneer_L` / `noseSneer_R` | Mũi nhăn (nhíu mũi) — dùng khi disgust |

**Landmark 1** = đầu mũi, dùng làm reference point cho head pose calculation.

---

## 8. Jaw — Hàm

| Keyword | Mô tả |
|---------|-------|
| `jawOpen` | Hàm mở xuống, `0` = ngậm, `1` = há hết cỡ |

`jawOpen` là morph target quan trọng nhất cho lip sync — kiểm soát độ há của miệng.

---

## 9. Mouth — Miệng

### Hình dạng môi

| Keyword | Mô tả | Dùng cho |
|---------|-------|----------|
| `mouthSmile_L` / `R` | Khóe miệng kéo lên (cười) | Smile, E, I viseme |
| `mouthFrown_L` / `R` | Khóe miệng kéo xuống (mếu) | Sad emotion |
| `mouthFunnel` | Môi tròn như thổi sáo | O, AW viseme |
| `mouthPucker` | Môi chu ra (hôn) | U, O viseme |
| `mouthStretch_L` / `R` | Miệng kéo rộng ngang | E, I viseme |
| `mouthPress_L` / `R` | Môi ép chặt vào nhau | M, B, P âm (âm môi) |

### Chuyển động môi

| Keyword | Mô tả |
|---------|-------|
| `mouthUpperUp_L` / `R` | Môi trên kéo lên (nhăn môi) |
| `mouthLowerDown_L` / `R` | Môi dưới kéo xuống |
| `mouthRollUpper` | Môi trên cuộn vào trong |
| `mouthRollLower` | Môi dưới cuộn vào trong |
| `mouthShrugUpper` | Môi trên nhún lên |
| `mouthShrugLower` | Môi dưới nhún xuống |
| `mouthLeft` / `mouthRight` | Toàn bộ miệng dịch ngang |

---

## 10. Viseme — Hình miệng

**Viseme** = đơn vị hình miệng tương ứng với một âm thanh (phoneme). Dùng cho lip sync.

| Viseme | Âm | jawOpen | Đặc trưng |
|--------|-----|---------|-----------|
| `rest` | im lặng | 0.02 | Môi khép nhẹ |
| `A`    | a, ă, â | 0.82 | Miệng mở rộng nhất |
| `AW`   | oa, oe | 0.56 | Môi tròn + hàm mở vừa |
| `E`    | e, ê | 0.22 | Miệng kéo ngang (smile) |
| `I`    | i, y | 0.18 | Kéo ngang hẹp hơn E |
| `O`    | o, ô, ơ | 0.44 | Môi tròn vừa (funnel) |
| `U`    | u, ư | 0.18 | Môi chu nhiều nhất (pucker) |
| `M`    | m, b, p | 0.04 | Môi khép + ép chặt |

> Lip sync controller chọn viseme gần nhất với âm đang phát, rồi lerp qua lại giữa các viseme.

---

## 11. Emotion — Cảm xúc

Presets kết hợp nhiều morph targets để tạo biểu cảm khuôn mặt.

| Emotion | Morph targets chính |
|---------|---------------------|
| `neutral` | Tất cả = 0 |
| `smile` | `mouthSmile`, `browInnerUp`, `cheekPuff` |
| `angry` | `browDown`, `eyeSquint`, `mouthFunnel` |
| `sad` | `browInnerUp`, `mouthFrown` |
| `surprise` | `browOuterUp`, `eyeWide`, `jawOpen` |
| `disgust` | `noseSneer`, `mouthUpperUp`, `mouthLowerDown` |
| `fear` | `browOuterUp`, `eyeWide`, `jawOpen`, `mouthFunnel` |

---

## 12. Bone & Quaternion

### Bones điều khiển mắt

```
Scene
 └── grp_eyeLeft    (THREE.Group)  ← xoay bằng quaternion
 └── grp_eyeRight   (THREE.Group)
```

**baseQuaternion** = quaternion trung tính của mắt lúc load model.
Khi xoay mắt: `eyeGroup.quaternion = deltaQ × baseQ` (không drift so với hướng gốc).

### Bones đầu/cổ

```
Spine2 (UpperChest)
 └── Neck      ← nhận 35% rotation
      └── Head ← nhận 65% rotation
```

Chia rotation giữa Neck và Head để tránh cổ trông cứng.

### Euler Order

- Head bone dùng `"YXZ"`: **Yaw** trước (quay ngang), **Pitch** sau (gật) — tránh gimbal lock.
- Eye bone dùng `"XYZ"`: Pitch trước, Yaw sau.

---

## 13. Blendshape / Morph Target

Hai thuật ngữ này **đồng nghĩa** trong dự án này:

| Thuật ngữ | Nguồn gốc | Dùng ở đâu |
|-----------|-----------|------------|
| **Blendshape** | Tên trong phần mềm 3D (Blender, Maya) | Tên gốc trong file GLTF |
| **Morph Target** | Tên trong Three.js API | Code JS (`morphTargetInfluences`) |

**Cách hoạt động:** Mỗi morph target lưu một bản sao mesh đã biến dạng. Giá trị `[0..1]` blend giữa mesh gốc và mesh biến dạng.

**BLENDSHAPE_MAP** — bảng chuyển đổi tên:
```
MediaPipe name    →    Model morph target name
eyeBlinkLeft      →    eyeBlink_R        (đảo L/R do mirror)
browDownLeft      →    browDown_R
mouthSmileLeft    →    mouthSmile_R
...
```

**updateMorphTargetSmooth()** — hàm set morph có lerp built-in, không set thẳng để tránh giật.

---

## 14. Smoothing — Làm mượt

### Lerp (Linear Interpolation / EMA)

```
output = lerp(previous, target, α)
       = previous + α × (target - previous)
```

| α value | Hiệu ứng |
|---------|----------|
| `0.25` | Mượt mạnh — morph blendshape (ít giật) |
| `0.30` | Cân bằng — head pose |
| `0.35` | Phản hồi nhanh hơn — eye bone rotation |
| `1.00` | Không smooth (pass-through) |

### Các α đang dùng trong dự án

| Thành phần | α | File |
|------------|---|------|
| Head yaw / pitch | 0.30 | `face_tracking_utils.js` |
| Head roll | 0.25 | `face_tracking_utils.js` |
| Eye rotation (pitch/yaw) | 0.35 | `face_tracking_utils.js` |
| Eye blendshape (up/down/in/out) | 0.25 | `face_tracking_utils.js` |
| Morph target chung | ~0.15–0.25 | `face_mesh.js` |

### smoothedValues

Object trong `state` của `face_mesh.js` lưu giá trị lerped của từng morph:
```js
state.smoothedValues = {
  "jawOpen": 0.23,
  "mouthSmile_L": 0.71,
  ...
}
```

### eyeNeutral — Hiệu chỉnh trung tính

15 frame đầu khi bắt đầu tracking, hệ thống thu mẫu vị trí iris và tính offset "nhìn thẳng":
```js
state.eyeNeutral = {
  leftPitch, leftYaw,
  rightPitch, rightYaw
}
```
Các frame sau trừ đi neutral offset → mắt không bị lệch khi người dùng nhìn thẳng vào camera.

---

## 15. Landmark — Điểm mốc

MediaPipe Face Mesh cho 478 điểm (468 mesh + 10 iris).

### Điểm quan trọng

| Index | Tên | Dùng cho |
|-------|-----|----------|
| 1 | Nose tip (đầu mũi) | Head pose yaw/pitch |
| 33 | Right eye inner corner | Eye tracking |
| 133 | Right eye outer corner | Eye tracking |
| 145 | Right eye lower lid | Eye height |
| 159 | Right eye upper lid | Eye height |
| 263 | Left eye outer corner | Eye tracking |
| 362 | Left eye inner corner | Eye tracking |
| 374 | Left eye lower lid | Eye height |
| 386 | Left eye upper lid | Eye height |
| 468–472 | Right iris (5 pts) | Iris direction |
| 473–477 | Left iris (5 pts) | Iris direction |

### EYE_LANDMARKS object

```js
{
  right: { inner: 33, outer: 133, upper: 159, lower: 145, iris: [468..472] },
  left:  { inner: 362, outer: 263, upper: 386, lower: 374, iris: [473..477] },
}
```

---

## 16. Quy ước L/R — Trái/Phải

> ⚠️ **Dễ nhầm nhất trong codebase.**

| Không gian | "Left" nghĩa là |
|------------|-----------------|
| **Camera / MediaPipe** | Trái của người xem (tức phải của nhân vật) |
| **Model / Three.js** | Trái của nhân vật (tức phải của người xem) |

**Kết quả:** Khi map từ MediaPipe → Model, phải **đảo L/R**:

```
MediaPipe: eyeBlinkLeft  →  Model: eyeBlink_R
MediaPipe: browDownLeft  →  Model: browDown_R
MediaPipe: mouthSmileLeft → Model: mouthSmile_R
```

**Ký hiệu trong code:**
- `_L` = trái của **model** (= phải trong camera selfie)
- `_R` = phải của **model** (= trái trong camera selfie)
- `Left` (không gạch dưới) = MediaPipe convention (góc camera)

---

## Quick Reference — Nhóm keyword theo vùng mặt

```
MẮT (Eye)
├── Mở/Nhắm:  eyeBlink, eyeSquint, eyeWide
├── Hướng nhìn: eyeLookUp, eyeLookDown, eyeLookIn, eyeLookOut
└── Iris:      grp_eyeLeft/Right, rotationPitch, rotationYaw

LÔNG MÀY (Brow)
└── browDown, browInnerUp, browOuterUp

MÁ / MŨI
└── cheekPuff, noseSneer

HÀM (Jaw)
└── jawOpen

MIỆNG (Mouth)
├── Hình dạng: mouthSmile, mouthFrown, mouthFunnel, mouthPucker, mouthStretch
├── Chuyển động: mouthUpperUp, mouthLowerDown, mouthRollUpper, mouthRollLower
└── Vị trí:    mouthLeft, mouthRight, mouthPress

ĐẦU/CỔ (Head/Neck)
└── pitch, yaw, roll → phân phối vào Neck (35%) + Head (65%)
```
