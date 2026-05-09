# Animation Retargeting — Áp animation lên skeleton khác kích thước/tỉ lệ

> Khi clip animation của một skeleton (ví dụ người lớn cao 1m75) được phát trên một skeleton khác (ví dụ trẻ em cao 1m20), nhân vật sẽ bay lơ lửng, lún xuống đất, tay xuyên đầu, hoặc đứng không đúng pose. Doc này giải thích **vì sao** và **4 strategy** để xử lý — gồm cả `THREE.SkeletonUtils.retargetClip` và pattern thủ công đang dùng trong `script/animation/character.js`.

**When to read**: load animation `.glb` từ Mixamo / chuyển clip giữa các model khác kích thước; nhân vật nhảy / trượt / bay sau khi `mixer.clipAction(...)`.

---

## 1. Tại sao cần retarget?

Một `AnimationClip` lưu **keyframe data theo tên bone** — nó **không biết gì về** kích thước, tỉ lệ, bind pose của skeleton đang phát nó. Khi áp lên skeleton khác, có 4 nguồn lệch:

| Nguồn lệch | Ví dụ | Hậu quả |
|------------|-------|---------|
| **Bone name khác** | clip có `mixamorigHips`, model có `Hips` | Track không bind được → không animate |
| **Position track tuyệt đối** | clip dịch hips lên 0.5m mỗi bước | Trên model nhỏ → bay; trên model lớn → bước ngắn |
| **Tỉ lệ bone (proportion)** | tay người lớn dài 0.6m, tay trẻ 0.4m | Quaternion vẫn đúng *góc*, nhưng vị trí điểm cuối lệch |
| **Bind pose khác** | source ở T-pose, target ở A-pose | Vai cứng / lệch ngay frame 0 |

Quaternion (xoay) **độc lập với scale** — nó vẫn áp đúng "nâng tay 30°" bất kể tay dài bao nhiêu. Position track thì **không** — nó là dịch chuyển tuyệt đối tính bằng đơn vị model gốc.

→ **Quy tắc**: hầu hết bug retargeting đến từ **position tracks** và **bone name mismatch**. Quaternion-only retargeting xử lý 80% trường hợp.

---

## 2. AnimationClip — bones và tracks

### Cấu trúc

```js
clip = {
  name:     "Walk",
  duration: 1.6,                                        // giây
  tracks: [
    QuaternionKeyframeTrack("mixamorigHips.quaternion",      times, values),
    VectorKeyframeTrack    ("mixamorigHips.position",        times, values),
    QuaternionKeyframeTrack("mixamorigSpine.quaternion",     times, values),
    QuaternionKeyframeTrack("mixamorigLeftArm.quaternion",   times, values),
    // ... 1 track per bone per property
  ],
}
```

### Format tên track

Three.js parse tên theo cú pháp [`PropertyBinding`](https://threejs.org/docs/#api/en/animation/PropertyBinding):

```
<nodeName>.<property>[<componentIndex>]
```

| Ví dụ | Ý nghĩa |
|-------|---------|
| `mixamorigHips.position` | Position của bone `mixamorigHips` (Vector3) |
| `mixamorigHips.quaternion` | Rotation (Quaternion 4 component) |
| `Wolf3D_Avatar.morphTargetInfluences[3]` | Morph target index 3 |
| `.bones[Hips].quaternion` | Format từ `SkeletonUtils.retargetClip` (xem §6) |

### Inspect clip để debug

```js
function inspectClip(clip) {
  console.group(`Clip "${clip.name}" (${clip.duration.toFixed(2)}s)`);
  console.log("Tracks:", clip.tracks.length);
  const types = {};
  for (const t of clip.tracks) {
    const dot = t.name.indexOf(".");
    const prop = t.name.slice(dot);
    types[prop] = (types[prop] || 0) + 1;
  }
  console.table(types);                                 // { ".quaternion": 65, ".position": 1, ... }
  console.log("First 5 names:", clip.tracks.slice(0, 5).map(t => t.name));
  console.groupEnd();
}
```

> **Pattern hữu ích**: nếu chỉ có 1 `.position` track (hips) — đây là Mixamo locomotion clip. Nếu có nhiều `.position` tracks — clip có in-place motion ở từng joint, hiếm gặp.

---

## 3. 4 Strategy retargeting

### Strategy A — Rotation-only (đơn giản, hoạt động ~80% case)

Bỏ tất cả `.position` tracks, giữ rotation. Quaternion là **tỉ lệ-bất-biến** → áp lên skeleton lớn/nhỏ vẫn đúng pose.

```js
function stripAllPositions(clip) {
  return new THREE.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter(t => !t.name.endsWith(".position")),
  );
}
```

| Ưu | Nhược |
|----|-------|
| Không cần biết tỉ lệ | Mất root motion (nhân vật đứng tại chỗ) |
| Không cần API ngoài | Nếu source dùng A-pose ≠ target T-pose → bind pose lệch |
| 1 dòng code | Chân có thể trượt nếu clip dùng position để giữ chân khỏi sàn |

**Khi dùng**: idle, gesture, dance loop in-place, các clip không di chuyển.

### Strategy B — Strip root hips position (đang dùng trong codebase)

Giữ position của các bone con (vd hips dao động lên xuống khi đi), chỉ bỏ position **gốc** của hips:

```js
// Đang ở script/animation/character.js
function stripRootHipsMotion(clip) {
  const tracks = clip.tracks.filter(
    (t) => !isMixamoRootHipsPositionTrack(t.name),
  );
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function isMixamoRootHipsPositionTrack(name) {
  if (!name.endsWith(".position")) return false;
  return /(^|\.)(mixamorigHips|mixamorig:Hips)\.position$/i.test(name);
}
```

→ Mixamo Walk/Run thường có `mixamorigHips.position` chứa offset di chuyển forward → strip để nhân vật không "trôi đi" khỏi origin scene.

| Ưu | Nhược |
|----|-------|
| Giữ được dao động vertical hips (thở, nhún khi đi) | Mất root motion translation hoàn toàn |
| Không cần biết tỉ lệ | Vẫn không xử lý bind pose mismatch |

**Khi dùng**: in-place locomotion (walk/run loop tại chỗ), nhân vật điều khiển bằng game logic (player position riêng).

### Strategy C — Scale position theo height ratio

Giữ root motion nhưng scale lại theo tỉ lệ chiều cao. Phù hợp khi animation cần dịch chuyển thật (ví dụ jump cinematic).

```js
function scaleClipPositions(clip, scale) {
  for (const t of clip.tracks) {
    if (t.name.endsWith(".position")) {
      for (let i = 0; i < t.values.length; i++) {
        t.values[i] *= scale;                           // áp cho cả x, y, z
      }
    }
  }
  return clip;
}

// Adult 1.75m → child 1.20m
const heightRatio = childHeight / adultHeight;          // 0.686
scaleClipPositions(walkClip, heightRatio);
```

> **Tính `heightRatio` từ bone**:
> ```js
> const adultHeight = adultBoneLengths.hipToChest + adultBoneLengths.chestToHead;
> const childHeight = childBoneLengths.hipToChest + childBoneLengths.chestToHead;
> ```

| Ưu | Nhược |
|----|-------|
| Giữ root motion đúng tỉ lệ | Không xử lý vai/tay khác tỉ lệ; chân vẫn có thể trượt |
| Dễ implement | Phải đo cả 2 skeleton |

### Strategy D — `SkeletonUtils.retargetClip` (full retarget, Three.js built-in)

Dùng khi 2 skeleton **khác nhiều** (Mixamo → custom VRM, hoặc rig hoàn toàn khác). API thật sự sample pose nguồn mỗi frame, áp `retarget()` chuyển sang skeleton đích, ghi lại thành tracks mới.

```js
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const retargetedClip = SkeletonUtils.retargetClip(
  targetSkin,                                           // SkinnedMesh đích
  sourceSkin,                                           // SkinnedMesh nguồn (cùng skeleton với clip)
  clip,
  {
    hip: "Hips",                                        // tên bone hip ở TARGET
    useFirstFramePosition: true,                        // trừ vị trí frame đầu → không nhảy
    fps: 30,                                            // sample rate (mặc định auto-tính)
    names: {                                            // map source bone name → target bone name
      mixamorigHips:        "Hips",
      mixamorigSpine:       "Spine",
      mixamorigSpine1:      "Chest",
      mixamorigSpine2:      "UpperChest",
      mixamorigNeck:        "Neck",
      mixamorigHead:        "Head",
      mixamorigLeftShoulder:"LeftShoulder",
      mixamorigLeftArm:     "LeftUpperArm",
      mixamorigLeftForeArm: "LeftLowerArm",
      mixamorigLeftHand:    "LeftHand",
      // ... full bone map
    },
  },
);
```

> ⚠️ **Default `hip: "hip"`** (lowercase). Nếu target dùng `"Hips"`, phải set explicit như trên — nếu không hip position track sẽ bị bỏ.

| Ưu | Nhược |
|----|-------|
| Xử lý đầy đủ name mapping + scale + bind pose | Cần load source skeleton (không chỉ clip) |
| Output là clip mới, dùng như clip thường | Sample-and-rebake → mất 50–500ms khi load |
| Hỗ trợ trim, fps custom | Tracks output ở format `.bones[name].quaternion` (xem §6) |

**Khi dùng**: Mixamo asset cho rig riêng / đổi pipeline / tích hợp animation từ Maya/Blender export khác.

### Tóm tắt — chọn strategy nào?

```
Cùng skeleton (chỉ swap clip Idle/Walk/Punch của cùng character)
  → Strategy B (strip root hips position) — đang dùng

Adult clip → Child model, cùng naming (Mixamo + Mixamo)
  → Strategy A (rotation-only) cho idle/gesture
  → Strategy C (scale positions) nếu cần root motion

Mixamo → Custom rig khác naming
  → Strategy D (SkeletonUtils.retargetClip) với names map

Bind pose khác (T ↔ A)
  → Strategy D, hoặc rebind thủ công (xem §7)
```

---

## 4. Code patterns — 5 helpers tái sử dụng

```js
// 1. Strip mọi position track (rotation-only)
function stripAllPositions(clip) {
  return new THREE.AnimationClip(
    clip.name, clip.duration,
    clip.tracks.filter(t => !t.name.endsWith(".position")),
  );
}

// 2. Strip chỉ root hips position (giữ position con) — đang dùng character.js
function stripRootHipsMotion(clip) {
  const RE = /(^|\.)(mixamorigHips|mixamorig:Hips|Hips)\.position$/i;
  return new THREE.AnimationClip(
    clip.name, clip.duration,
    clip.tracks.filter(t => !(t.name.endsWith(".position") && RE.test(t.name))),
  );
}

// 3. Rename bone tracks (mixamorig → custom convention)
function renameTracks(clip, nameMap) {
  for (const t of clip.tracks) {
    const dot = t.name.indexOf(".");
    if (dot < 0) continue;
    const boneName = t.name.slice(0, dot);
    const tail     = t.name.slice(dot);                 // ".quaternion" hoặc ".position"
    if (nameMap[boneName]) t.name = nameMap[boneName] + tail;
  }
  return clip;
}

// 4. Scale position tracks theo tỉ lệ chiều cao
function scaleClipPositions(clip, scale) {
  for (const t of clip.tracks) {
    if (!t.name.endsWith(".position")) continue;
    for (let i = 0; i < t.values.length; i++) t.values[i] *= scale;
  }
  return clip;
}

// 5. Pin Y của hips (chân không lún, không bay) — giữ x/z
function pinHipsY(clip, hipsY) {
  for (const t of clip.tracks) {
    if (!/Hips\.position$/i.test(t.name)) continue;
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i + 1] = hipsY;                          // y component
    }
  }
  return clip;
}
```

### Compose

```js
function prepareClipForCharacter(clip, opts) {
  let c = clip.clone();
  c.name = c.name === "mixamo.com" ? opts.fallbackName : c.name;
  c = renameTracks(c, MIXAMO_TO_VRM);
  c = stripRootHipsMotion(c);
  if (opts.heightRatio !== 1) c = scaleClipPositions(c, opts.heightRatio);
  return c;
}
```

---

## 5. Case study — Adult → Child

| | Adult source | Child target |
|--|--------------|--------------|
| Tổng chiều cao | 1.75 m | 1.20 m |
| Tay (vai → cổ tay) | 0.55 m | 0.34 m |
| Chân (hips → mắt cá) | 0.92 m | 0.62 m |
| heightRatio | 1.0 | **0.686** |
| armRatio | 1.0 | **0.618** |
| legRatio | 1.0 | **0.674** |

### Kết quả từng strategy

| Strategy | Pose | Root motion | Tay với tới đồ | Đánh giá |
|----------|------|-------------|---------------|----------|
| A. Rotation-only | ✅ đúng | ❌ tại chỗ | ❌ với hụt (tay ngắn hơn) | OK cho idle/gesture |
| B. Strip root hips | ✅ đúng | ❌ tại chỗ (giữ bob) | ❌ với hụt | OK cho walk loop |
| C. Scale positions × 0.686 | ✅ đúng | ✅ đúng tỉ lệ | ❌ với hụt | OK cho cinematic |
| D. retargetClip | ✅ đúng + bind pose | ✅ đúng | ⚠️ vẫn lệch | + procedural IK overlay |

**Insight quan trọng**: Không strategy nào tự xử lý "tay với đồ" — đó là vấn đề **scale-aware**, cần **IK override** (xem [`../03-body-parts/arm.md`](../03-body-parts/arm.md)). Cách làm production:

```
1. Retarget clip (D) cho pose nền  → upper body trông tự nhiên
2. Khi nhân vật cần cầm vật cụ thể → IK override tay từ wristTarget của vật
3. Blend giữa clip pose và IK pose theo trọng số
```

---

## 6. SkeletonUtils — caveat thực tế

### Output track format

`retargetClip()` trả về tracks tên `.bones[BoneName].quaternion` thay vì `BoneName.quaternion`. Lý do: cú pháp này bind qua `Skeleton.bones` map thay vì traverse từ root.

→ Khi dùng, mixer phải tạo từ skeleton, không phải từ scene root:

```js
// ❌ Có thể không bind được
const mixer = new THREE.AnimationMixer(targetScene);

// ✅ Bind đúng nếu clip được retarget
const mixer = new THREE.AnimationMixer(targetSkin);     // SkinnedMesh có skeleton
mixer.clipAction(retargetedClip).play();
```

### `useFirstFramePosition: true` — quan trọng

Mặc định `false` → hips position track giữ giá trị tuyệt đối từ source → nhân vật **nhảy lên/xuống đột ngột** ở frame 0. Set `true` để trừ vị trí frame đầu, animation bắt đầu từ origin của target.

### Bind pose mismatch (T vs A)

`retarget()` áp pose source lên target qua **world matrix** — nó coi rest pose (skeleton.bones[i].matrixWorld lúc setup) là "0 reference". Nếu source là T-pose (tay ngang) và target là A-pose (tay buông xuống), retarget vẫn ra đúng *target pose* sau khi áp clip. Nhưng nếu clip bắt đầu bằng T-pose snapshot, frame 0 sẽ trông kỳ.

**Workaround**: chỉnh target về T-pose tạm trước khi retarget, hoặc dùng `preserveBoneMatrix: false` để force reset.

---

## 7. Mixamo specifics

### Naming

Mixamo dùng prefix `mixamorig` (không gạch dưới) hoặc `mixamorig:` (có dấu hai chấm trong một số export):

```
mixamorigHips, mixamorigSpine, mixamorigSpine1, mixamorigSpine2
mixamorigNeck, mixamorigHead
mixamorigLeftShoulder, mixamorigLeftArm, mixamorigLeftForeArm, mixamorigLeftHand
mixamorigLeftHandThumb1/2/3
mixamorigLeftHandIndex1/2/3
mixamorigLeftHandMiddle1/2/3
mixamorigLeftHandRing1/2/3
mixamorigLeftHandPinky1/2/3
mixamorigLeftUpLeg, mixamorigLeftLeg, mixamorigLeftFoot, mixamorigLeftToeBase
(và bộ Right tương ứng)
```

Mixamo → VRM/custom map gợi ý:

```js
const MIXAMO_TO_VRM = {
  mixamorigHips:           "Hips",
  mixamorigSpine:          "Spine",
  mixamorigSpine1:         "Chest",
  mixamorigSpine2:         "UpperChest",
  mixamorigNeck:           "Neck",
  mixamorigHead:           "Head",
  mixamorigLeftShoulder:   "LeftShoulder",
  mixamorigLeftArm:        "LeftUpperArm",
  mixamorigLeftForeArm:    "LeftLowerArm",
  mixamorigLeftHand:       "LeftHand",
  mixamorigRightShoulder:  "RightShoulder",
  mixamorigRightArm:       "RightUpperArm",
  mixamorigRightForeArm:   "RightLowerArm",
  mixamorigRightHand:      "RightHand",
  mixamorigLeftUpLeg:      "LeftUpperLeg",
  mixamorigLeftLeg:        "LeftLowerLeg",
  mixamorigLeftFoot:       "LeftFoot",
  mixamorigLeftToeBase:    "LeftToes",
  mixamorigRightUpLeg:     "RightUpperLeg",
  mixamorigRightLeg:       "RightLowerLeg",
  mixamorigRightFoot:      "RightFoot",
  mixamorigRightToeBase:   "RightToes",
  // Fingers nếu cần
};
```

### Clip name "mixamo.com"

Mixamo đặt `clip.name = "mixamo.com"` — đặt fallback name khi load (đã có trong `character.js`):

```js
function clipWithFallbackName(clip, fallbackName) {
  const c = clip.clone();
  c.name = !c.name || c.name === "mixamo.com" ? fallbackName : c.name;
  return c;
}
```

### Common problems

| Triệu chứng | Nguyên nhân | Fix |
|-------------|-------------|-----|
| Nhân vật trôi đi 5m mỗi lần loop | `mixamorigHips.position` chứa walk forward | `stripRootHipsMotion()` |
| Tay bay lên trời ở frame 0 | bind pose source ≠ target | `useFirstFramePosition: true` hoặc retargetClip |
| Animation 0 frame, đứng yên | Bone name không match (sai map) | `inspectClip(clip)` + log `bones[name]` |
| Hai tay flip ngang | Mixamo export "Y up but Z forward" sai | Re-export với Y up, hoặc xoay model -90° quanh X |

---

## 8. Quy trình check khi thêm clip mới

```
1. Load clip:
     const gltf = await loader.loadAsync(path);
     inspectClip(gltf.animations[0]);
     // Kiểm: số tracks, có .position nào không, naming pattern

2. Load target model:
     listAllBones(model);
     // So sánh tên với clip — nếu khác → cần renameTracks hoặc retargetClip

3. Đo proportion:
     const targetH = boneLengths.hipToChest + boneLengths.chestToHead;
     const sourceH = ...; // nếu biết
     const heightRatio = targetH / sourceH;

4. Chọn strategy (xem §3 tóm tắt):
     - Cùng skeleton → stripRootHipsMotion
     - Khác name → renameTracks
     - Khác kích thước, có root motion → scaleClipPositions(ratio)
     - Khác hoàn toàn → SkeletonUtils.retargetClip với names map

5. Test với SkeletonHelper:
     skeleton.visible = true;
     // Frame-by-frame: skeleton có cong gãy bất thường không?

6. So sánh với clip gốc trên model gốc (nếu có) để đối chứng pose.
```

---

## 9. Troubleshooting

| Triệu chứng | Nguyên nhân | Giải pháp |
|-------------|-------------|-----------|
| Bay khỏi gốc / trượt forward | `Hips.position` track không strip | `stripRootHipsMotion()` |
| Lún xuống đất | `Hips.position` Y âm trong clip | `pinHipsY(clip, 0)` hoặc `stripAllPositions()` |
| Animation đứng yên | Tracks rỗng sau filter / bone name không match | `inspectClip()` log; check `bones[trackName]` tồn tại |
| Tay xuyên đầu / chân chéo | Bind pose mismatch (T ↔ A) | `SkeletonUtils.retargetClip` với `useFirstFramePosition: true` |
| Bước ngắn hơn đáng lẽ | Scale model ≠ 1 mà clip hard-coded position | `scaleClipPositions(heightRatio)` |
| Tay không tới target IK | Proportion mismatch (tay ngắn hơn nguồn) | IK override (skill `body-controllers`) |
| Clip name "mixamo.com" hiện trong GUI | Mixamo export chưa rename | `clipWithFallbackName(clip, "Walk")` |
| Mixer không play sau retargetClip | Track output ở `.bones[...]`, mixer root sai | Mixer phải bind vào SkinnedMesh, không phải Scene |
| Frame 0 nhảy đột ngột | retargetClip default `useFirstFramePosition: false` | Set `true` |
| Default hip option bị bỏ | `retarget()` default `hip: "hip"` (lowercase) | Set `hip: "Hips"` explicit |

---

## 10. Pattern kết hợp đầy đủ (production)

```js
import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

async function loadAndRetarget(path, targetSkin, sourceSkin, options = {}) {
  const gltf = await new GLTFLoader().loadAsync(path);
  const sourceClip = gltf.animations[0];

  // Strategy: dùng retargetClip nếu skeleton khác, không thì strip + scale
  let clip;
  if (options.useRetargetClip) {
    clip = SkeletonUtils.retargetClip(targetSkin, sourceSkin, sourceClip, {
      hip: options.hipName || "Hips",
      useFirstFramePosition: true,
      names: options.nameMap || {},
    });
  } else {
    clip = sourceClip.clone();
    if (options.nameMap) clip = renameTracks(clip, options.nameMap);
    clip = stripRootHipsMotion(clip);
    if (options.heightRatio && options.heightRatio !== 1) {
      clip = scaleClipPositions(clip, options.heightRatio);
    }
  }

  clip.name = options.fallbackName || sourceClip.name;
  return clip;
}
```

---

## Tham khảo

- Source SkeletonUtils: `node_modules/three/examples/jsm/utils/SkeletonUtils.js` — `retarget()` line 39, `retargetClip()` line 226.
- Three.js docs: [`PropertyBinding`](https://threejs.org/docs/#api/en/animation/PropertyBinding) (parse track name).
- Code đang dùng: `script/animation/character.js` — `stripRootHipsMotion`, `clipWithFallbackName`.
- Convention bone naming: [model-setup.md §1](model-setup.md).
- IK override sau retarget: [../03-body-parts/arm.md](../03-body-parts/arm.md).

---

← Prev: [animation-mixer.md](animation-mixer.md) | **Up**: [README](../README.md) | Next: [character-controller.md →](character-controller.md)
