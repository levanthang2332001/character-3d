---
name: three-animation-mixer
description: Three.js AnimationMixer + AnimationAction + clipAction + crossFade — pattern chuẩn dùng trong script/animation/character.js. Use this when the user asks về animation clip, blend weight, crossFadeTo, mixer.update, fadeIn/fadeOut, LoopRepeat, hoặc khi cần thêm/đổi clip animation cho nhân vật, đồng bộ chuyển trạng thái (idle → walk → run), hoặc fix bug "animation không chạy / giật".
---

# Three.js AnimationMixer — Pattern dùng trong HoloLab

## Khi nào dùng skill này

Bất cứ khi nào đụng vào `mixer`, `AnimationAction`, `clipAction`, `crossFadeTo`, `setEffectiveWeight` — xem `script/animation/character.js` là reference đang chạy.

## Khái niệm 3 lớp

```
AnimationClip          dữ liệu thuần (keyframe tracks, không tự chạy)
   ↓ mixer.clipAction(clip)
AnimationAction        instance đang play với weight + time + paused
   ↓ mixer.update(dt)
bones.rotation         pose cuối = Σ(clipPose × weight) áp lên skeleton
```

## Setup tối thiểu

```js
const mixer = new THREE.AnimationMixer(model);          // root = scene của GLB
const idleAction = mixer.clipAction(gltf.animations[0]);
idleAction.play();

// Render loop
const timer = new THREE.Timer();
timer.connect(document);                                // tự pause khi tab ẩn
function frame() {
  timer.update();
  mixer.update(timer.getDelta());                       // BẮT BUỘC mỗi frame
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
```

> Dùng `THREE.Timer` thay `THREE.Clock` — Timer pause khi tab hidden, Clock không.

## Pattern set weight đúng cách

```js
function setWeight(action, weight) {
  action.enabled = true;
  action.setEffectiveTimeScale(1);                      // reset (crossFadeTo có thể đã đổi)
  action.setEffectiveWeight(weight);
}
```

Lý do: `crossFadeTo(other, dur, true)` warp timeScale của 2 action; nếu sau đó set `weight = 1` mà không reset, action sẽ chạy nhanh/chậm bất thường.

## Pattern bật all action

```js
function activateAllActions() {
  setWeight(idleAction, 1.0);
  setWeight(walkAction, 0.0);
  setWeight(runAction,  0.0);
  [idleAction, walkAction, runAction].forEach(a => a.play());  // play hết, dùng weight để chọn
}
```

→ Không stop/start để đổi state — sẽ jerk vì time bị reset.

## CrossFade pattern

```js
function executeCrossFade(startAction, endAction, duration) {
  setWeight(endAction, 1);
  endAction.time = 0;                                   // reset clip về đầu
  startAction.crossFadeTo(endAction, duration, true);   // warp = true: đồng bộ tốc độ 2 clip
}

function synchronizeCrossFade(startAction, endAction, duration) {
  // Chờ kết thúc loop hiện tại mới chuyển — đúng nhịp bước
  mixer.addEventListener("loop", function onLoop(event) {
    if (event.action === startAction) {
      mixer.removeEventListener("loop", onLoop);
      executeCrossFade(startAction, endAction, duration);
    }
  });
}
```

Idle dài → bắt đầu fade ngay; walk/run nhịp ngắn → chờ loop cho đẹp.

## Duration gợi ý

| Chuyển | Duration |
|--------|----------|
| idle → walk | 0.5s (vào hoạt động nhanh) |
| walk → idle | 1.0s (dừng tự nhiên) |
| walk → run | 2.5s (tăng tốc) |
| run → walk | 5.0s (giảm tốc, momentum) |

## Pattern: dùng walk clip làm "fake run"

Khi không có file Run.glb riêng:

```js
state.runUsesWalkClip = !optionalRunGltf;
const runClip = optionalRunGltf?.animations?.[0]
  ? cleanupClip(optionalRunGltf.animations[0])
  : walkClip.clone();                                   // fallback

// Trong render loop, scale time của runAction theo runWeight:
if (state.runUsesWalkClip && runAction.getEffectiveWeight() > 0) {
  const w = runAction.getEffectiveWeight();
  const blend = THREE.MathUtils.smoothstep(w, 0, 1);
  const scale = 1 + (RUN_SPEED_VS_WALK - 1) * blend;    // 1.0 → 2.35
  runAction.setEffectiveTimeScale(scale);
}
```

→ Run "lấy đà" mượt thay vì nhảy thẳng lên 2.35x.

## Mixamo cleanup — strip root motion

Mixamo clip thường có position track trên `mixamorigHips` → nhân vật bị đẩy đi xa khỏi origin. Filter trước khi tạo `AnimationAction`:

```js
function stripRootHipsMotion(clip) {
  const tracks = clip.tracks.filter(t => {
    if (!t.name.endsWith(".position")) return true;
    return !/(^|\.)(mixamorigHips|mixamorig:Hips)\.position$/i.test(t.name);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
```

## Single step debug

```js
let singleStepMode = false;
let stepSize = 0.05;
function frame() {
  let dt = singleStepMode ? stepSize : timer.getDelta();
  if (singleStepMode) stepSize = 0;                     // chỉ advance 1 lần
  mixer.update(dt);
}
```

## API cheatsheet

```js
action.play() / pause() / stop() / reset()
action.time = 1.5                                       // seek
action.loop = THREE.LoopRepeat | LoopOnce | LoopPingPong
action.repetitions = Infinity
action.clampWhenFinished = true                         // giữ pose cuối khi LoopOnce kết thúc
action.fadeIn(d) / fadeOut(d)
action.crossFadeTo(other, d, warp)
action.getEffectiveWeight()
mixer.addEventListener("loop"|"finished", cb)
mixer.timeScale = 0.5                                   // toàn cục half speed
```

## Khi gesture procedural đè lên Mixer

Dùng skill `procedural-gestures` — pattern là **lưu base quaternion sau khi mixer update**, rồi `quaternion.multiply(offset)`. KHÔNG set rotation trực tiếp (sẽ bị mixer ghi đè frame sau).

## Khi clip lệch kích thước / khác skeleton (retargeting)

Clip Mixamo người lớn áp lên model trẻ em / model có bone naming khác → nhân vật trôi đi, lún xuống đất, tay xuyên đầu, hoặc đứng không đúng pose. 4 strategy:

1. **Rotation-only** — `stripAllPositions(clip)` (đơn giản nhất, mất root motion).
2. **Strip root hips position** — `stripRootHipsMotion(clip)` (đang dùng cho Mixamo Walk/Run trong codebase).
3. **Scale positions theo heightRatio** — `scaleClipPositions(clip, target_h / source_h)`.
4. **`SkeletonUtils.retargetClip(target, source, clip, { hip, names, useFirstFramePosition })`** — full retarget với name map.

Pattern + bảng so sánh + Mixamo→VRM name map đầy đủ: [`docs/02-rig/animation-retargeting.md`](../../../docs/02-rig/animation-retargeting.md).

**Lưu ý nhanh**:
- `retargetClip` default `hip: "hip"` (lowercase) → phải set `hip: "Hips"` cho hầu hết model.
- Output tracks ở format `.bones[name].quaternion` → mixer phải bind vào `SkinnedMesh`, không phải scene root.
- `useFirstFramePosition: true` để tránh frame 0 nhảy đột ngột.

## Reference

- Code đang chạy: `script/animation/character.js` (toàn bộ flow setup → load → mixer → crossFade GUI).
- Doc đầy đủ + sơ đồ: `docs/02-rig/animation-mixer.md`.
- Doc retargeting (clip ↔ skeleton khác): `docs/02-rig/animation-retargeting.md`.
- Three.js example gốc: `script/animation/demo.html`.
