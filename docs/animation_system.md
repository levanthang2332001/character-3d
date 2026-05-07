# Animation System — Three.js Skeletal Animation & Blending

Tài liệu này phân tích ví dụ chính thức của Three.js:
[`webgl_animation_skinning_blending`](https://threejs.org/examples/#webgl_animation_skinning_blending)

Model: Soldier.glb từ Mixamo — có 3 clip: **idle**, **walk**, **run**.

---

## Mục lục

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [AnimationClip — Dữ liệu animation](#2-animationclip--dữ-liệu-animation)
3. [AnimationMixer — Bộ điều phối](#3-animationmixer--bộ-điều-phối)
4. [AnimationAction — Một clip đang chạy](#4-animationaction--một-clip-đang-chạy)
5. [Blend Weights — Pha trộn nhiều animation](#5-blend-weights--pha-trộn-nhiều-animation)
6. [CrossFade — Chuyển cảnh mượt mà](#6-crossfade--chuyển-cảnh-mượt-mà)
7. [Render Loop — Cập nhật mỗi frame](#7-render-loop--cập-nhật-mỗi-frame)
8. [SkeletonHelper — Debug xương](#8-skeletonhelper--debug-xương)
9. [Tóm tắt API nhanh](#9-tóm-tắt-api-nhanh)
10. [Ứng dụng vào dự án HoloLab](#10-ứng-dụng-vào-dự-án-hololab)

---

## 1. Kiến trúc tổng quan

```
GLTF file (Soldier.glb)
├── gltf.scene       → THREE.Group  (mesh + bones)
└── gltf.animations  → AnimationClip[]
        [0] idle
        [1] run
        [3] walk

                        ┌─────────────────────────────────┐
gltf.scene ──────────► │   AnimationMixer                │
                        │   (gắn với root object)         │
                        │                                 │
gltf.animations ──────► │   clipAction(clip)              │
                        │       ↓                         │
                        │   AnimationAction × 3           │
                        │   ┌──────┐ ┌──────┐ ┌──────┐  │
                        │   │idle  │ │walk  │ │run   │  │
                        │   │w=0.0 │ │w=1.0 │ │w=0.0 │  │
                        │   └──────┘ └──────┘ └──────┘  │
                        │                                 │
                        │   mixer.update(deltaTime) ──►  │
                        │       tính pose = Σ(clip×w)    │
                        └─────────────────────────────────┘
                                        │
                                        ▼
                              bones.rotation/position
                              (áp lên skeleton mỗi frame)
```

**Luồng dữ liệu:**
1. `AnimationClip` chứa keyframe tracks (bone rotation, position theo thời gian)
2. `AnimationMixer` kết nối với scene object, quản lý nhiều `AnimationAction`
3. `AnimationAction` = một clip đang được play với weight và timeScale riêng
4. `mixer.update(dt)` mỗi frame → tính pose cuối = tổng blend có trọng số của tất cả action

---

## 2. AnimationClip — Dữ liệu animation

**AnimationClip** là dữ liệu thuần túy — không biết về scene, không tự chạy.

```js
// Cấu trúc bên trong một AnimationClip
clip = {
  name:     "idle",
  duration: 4.0,          // giây
  tracks: [               // mảng KeyframeTracks
    QuaternionKeyframeTrack("mixamorigHips.quaternion", times, values),
    VectorKeyframeTrack("mixamorigHips.position",      times, values),
    QuaternionKeyframeTrack("mixamorigSpine.quaternion", ...),
    // ... một track per bone per property
  ]
}
```

**Quan trọng:** GLTF loader tự parse animation data và tạo sẵn `gltf.animations[]`.
Không cần tạo thủ công trừ khi làm procedural animation.

```js
const animations = gltf.animations;  // AnimationClip[]
// animations[0] = idle (4 giây)
// animations[1] = run
// animations[3] = walk
```

---

## 3. AnimationMixer — Bộ điều phối

**AnimationMixer** là "nhạc trưởng" — biết tất cả action đang chạy và tổng hợp kết quả.

### Khởi tạo

```js
// Phải truyền vào root object của model (scene hoặc group)
mixer = new THREE.AnimationMixer(model);
```

### Thuộc tính quan trọng

```js
mixer.timeScale = 1.0;   // tốc độ toàn cục: 0 = đứng, 0.5 = nửa tốc, 2.0 = gấp đôi
mixer.time;              // thời gian tuyệt đối hiện tại (readonly)
```

### Phương thức

```js
// Tạo hoặc lấy lại AnimationAction từ một clip
const action = mixer.clipAction(clip);
// clipAction() có cache: gọi nhiều lần cùng clip → trả về cùng object

// Dừng và reset tất cả action
mixer.stopAllAction();

// Lấy action đang play từ một clip (trả về null nếu không tìm thấy)
mixer.existingAction(clip);

// Cập nhật tất cả action — GỌI MỖI FRAME với deltaTime (giây)
mixer.update(deltaTime);
```

### Events

```js
// Khi một action kết thúc loop
mixer.addEventListener('loop', (event) => {
  console.log(event.action);   // AnimationAction vừa loop
  console.log(event.loopDelta); // số loop đã qua
});

// Khi một action kết thúc hoàn toàn (hết repetitions)
mixer.addEventListener('finished', (event) => {
  console.log(event.action);
});
```

**Dùng trong `synchronizeCrossFade`:** chờ đến khi action hiện tại hoàn thành loop rồi mới chuyển sang action tiếp theo — transition đúng nhịp, không cắt giữa chừng.

```js
function synchronizeCrossFade(startAction, endAction, duration) {
  mixer.addEventListener('loop', function onLoop(event) {
    if (event.action === startAction) {
      mixer.removeEventListener('loop', onLoop);
      executeCrossFade(startAction, endAction, duration);
    }
  });
}
```

---

## 4. AnimationAction — Một clip đang chạy

**AnimationAction** = instance của một clip với state riêng (weight, time, paused...).

### Vòng đời cơ bản

```js
const action = mixer.clipAction(clip);

action.play();    // bắt đầu phát (hoặc tiếp tục nếu paused)
action.pause();   // tạm dừng (giữ pose hiện tại)
action.stop();    // dừng + reset về đầu
action.reset();   // reset time về 0, unpaused — không stop
```

### Thuộc tính thường dùng

```js
action.paused    = false;  // true = đứng yên tại pose hiện tại
action.enabled   = true;   // false = tắt hoàn toàn (không contribute vào blend)
action.time      = 0;      // thời gian hiện tại trong clip (giây) — set để seek
action.loop      = THREE.LoopRepeat;  // LoopRepeat | LoopOnce | LoopPingPong
action.repetitions = Infinity;         // số lần lặp
action.clampWhenFinished = false;      // true = giữ pose cuối khi kết thúc
```

### Weight và TimeScale

```js
// Weight: bao nhiêu % action này đóng góp vào pose cuối
action.weight = 1.0;

// Cách đúng để set (reset enabled + timeScale trước):
function setWeight(action, weight) {
  action.enabled = true;
  action.setEffectiveTimeScale(1);   // reset timeScale về 1
  action.setEffectiveWeight(weight); // set weight thực tế
}

// Đọc weight hiện tại (bao gồm cả hiệu ứng fade)
const w = action.getEffectiveWeight();

// TimeScale riêng cho action này (nhân với mixer.timeScale)
action.timeScale = 1.0;
action.setEffectiveTimeScale(1.5);  // chạy nhanh hơn 1.5×
```

> **Tại sao `setEffectiveWeight` thay vì `action.weight = ...`?**
> `crossFadeTo()` tự động thay đổi `timeScale` của action (để đồng bộ độ dài clip).
> `setEffectiveTimeScale(1)` + `setEffectiveWeight(w)` sẽ override các giá trị đó → hành vi dự đoán được.

### Loop modes

```js
action.loop = THREE.LoopRepeat;    // mặc định: lặp mãi
action.loop = THREE.LoopOnce;      // chỉ chạy 1 lần rồi stop
action.loop = THREE.LoopPingPong;  // A→B→A→B... (đổi chiều mỗi lần)
```

### Fade in / Fade out

```js
action.fadeIn(duration);     // weight 0→1 trong `duration` giây
action.fadeOut(duration);    // weight 1→0 trong `duration` giây

// Thường dùng kết hợp:
action.reset().fadeIn(0.5).play();  // chaining API
```

---

## 5. Blend Weights — Pha trộn nhiều animation

Đây là tính năng quan trọng nhất của animation system.

### Nguyên lý

```
Pose cuối = Σ (pose[i] × weight[i])

Ví dụ:
  idle.weight = 0.3
  walk.weight = 0.7
  run.weight  = 0.0

  → nhân vật đi chậm chạm với dáng hơi đứng yên
```

Three.js **không bắt buộc** tổng weight = 1. Nếu tổng > 1, kết quả vẫn được normalize tự động.

### Ví dụ từ example

```js
// Bật cả 3 action cùng lúc với weight khác nhau:
function activateAllActions() {
  setWeight(idleAction, 0.0);  // không chạy
  setWeight(walkAction, 1.0);  // chỉ walk
  setWeight(runAction,  0.0);  // không chạy

  // Tất cả đều .play() — nhưng weight = 0 nghĩa là không ảnh hưởng
  idleAction.play();
  walkAction.play();
  runAction.play();
}
```

> **Pattern quan trọng:** Play tất cả action từ đầu, thay đổi weight để chuyển trạng thái.
> Không stop/start — tránh jerk khi chuyển (clip vẫn đang advance time kể cả khi weight = 0).

### Manual blend (không dùng crossfade)

```js
// Trong render loop — pha trộn idle/walk theo tốc độ di chuyển:
const speed = 0.5;   // 0 = đứng, 1 = chạy tối đa
setWeight(idleAction, 1.0 - speed);
setWeight(walkAction, speed);
```

---

## 6. CrossFade — Chuyển cảnh mượt mà

`crossFadeTo()` là shortcut để fade out action hiện tại và fade in action mới.

### API cơ bản

```js
// startAction fade out, endAction fade in, trong `duration` giây
startAction.crossFadeTo(endAction, duration, warp);
```

**Tham số `warp`** (boolean):
- `true` = **warp mode** — điều chỉnh timeScale của cả 2 action để chúng đồng bộ tốc độ
  - Ví dụ: walk (1s/loop) → run (0.6s/loop): warp sẽ slow walk và speed up run dần dần
- `false` = chỉ blend weight, không điều chỉnh tốc độ

### Hàm chuẩn từ example

```js
function executeCrossFade(startAction, endAction, duration) {
  // endAction phải có weight = 1 TRƯỚC khi fade
  // (startAction đã có weight = 1 từ trước rồi)
  setWeight(endAction, 1);
  endAction.time = 0;   // reset về đầu clip

  // warp = true: tốt cho chuyển giữa các clip có thời lượng khác nhau
  startAction.crossFadeTo(endAction, duration, true);
}
```

### CrossFade đồng bộ với loop

```js
// Chờ startAction kết thúc loop hiện tại → crossfade đúng nhịp
function synchronizeCrossFade(startAction, endAction, duration) {
  mixer.addEventListener('loop', function onLoop(event) {
    if (event.action === startAction) {
      mixer.removeEventListener('loop', onLoop);
      executeCrossFade(startAction, endAction, duration);
    }
  });
}

function prepareCrossFade(startAction, endAction, defaultDuration) {
  const duration = useDefaultDuration ? defaultDuration : customDuration;

  if (startAction === idleAction) {
    // idle (4s) — bắt đầu ngay, không cần chờ loop
    executeCrossFade(startAction, endAction, duration);
  } else {
    // walk/run — chờ kết thúc bước đi hiện tại mới chuyển
    synchronizeCrossFade(startAction, endAction, duration);
  }
}
```

### Duration gợi ý

| Chuyển | Duration |
|--------|----------|
| idle → walk | 0.5s (nhanh, vào hoạt động) |
| walk → idle | 1.0s (chậm, dừng tự nhiên) |
| walk → run | 2.5s (tăng tốc dần) |
| run → walk | 5.0s (giảm tốc dài, momentum) |

---

## 7. Render Loop — Cập nhật mỗi frame

```js
// Khai báo Timer (Three.js r152+)
const timer = new THREE.Timer();
timer.connect(document);  // tự pause khi tab bị ẩn

function animate() {
  timer.update();

  // Đọc delta time (giây kể từ frame trước)
  let dt = timer.getDelta();  // thường ~0.016 ở 60fps

  // Single step mode: chạy từng bước khi debug
  if (singleStepMode) {
    dt = sizeOfNextStep;
    sizeOfNextStep = 0;       // chỉ advance 1 lần, rồi đứng yên
  }

  // CẬP NHẬT MIXER — bắt buộc mỗi frame
  mixer.update(dt);

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

> **`THREE.Timer` vs `clock.getDelta()`:**
> `THREE.Timer` tự động pause khi browser tab bị ẩn → tránh dt lớn bất thường khi quay lại tab.
> `THREE.Clock` vẫn chạy ngầm → dt có thể = vài giây → animation bị nhảy.

### Single Step Mode — Debug từng frame

```js
let singleStepMode = false;
let sizeOfNextStep = 0;

function toSingleStepMode() {
  unPauseAllActions();
  singleStepMode = true;
  sizeOfNextStep = 0.05;   // advance 50ms mỗi lần bấm nút
}

// Trong animate():
if (singleStepMode) {
  dt = sizeOfNextStep;
  sizeOfNextStep = 0;   // dừng sau 1 step
}
mixer.update(dt);
```

---

## 8. SkeletonHelper — Debug xương

```js
// Tạo skeleton helper (vẽ lines theo xương)
skeleton = new THREE.SkeletonHelper(model);
skeleton.visible = false;   // ẩn mặc định
scene.add(skeleton);

// Toggle khi cần debug
skeleton.visible = true;
```

`SkeletonHelper` tự cập nhật theo model mỗi frame (không cần gọi thêm gì).
Dùng để kiểm tra:
- Bone hierarchy có đúng không
- Animation có ảnh hưởng đúng bone không
- Xương có bị offset/twist bất thường không

---

## 9. Tóm tắt API nhanh

### Setup

```js
const mixer = new THREE.AnimationMixer(model);
const action = mixer.clipAction(gltf.animations[0]);

action.play();
```

### Control

```js
action.paused = true/false      // tạm dừng
action.stop()                   // dừng + reset
action.reset().play()           // restart từ đầu
action.time = 2.0               // seek đến giây thứ 2
mixer.timeScale = 0.5           // half speed toàn bộ
```

### Blend

```js
action.setEffectiveWeight(0.7)  // đóng góp 70%
action.getEffectiveWeight()     // đọc weight hiện tại
```

### CrossFade

```js
actionA.crossFadeTo(actionB, 0.5, true)  // 0.5s, có warp
actionA.fadeOut(0.3)                     // chỉ fade out A
actionB.reset().fadeIn(0.3).play()       // fade in B
```

### Render loop

```js
mixer.update(deltaTime)   // bắt buộc mỗi frame (deltaTime tính bằng GIÂY)
```

---

## 10. Ứng dụng vào dự án HoloLab

Dự án hiện tại dùng morph targets + bone rotation trực tiếp (face tracking).
Khi cần thêm **body animation** (idle, gesture, react), sẽ tích hợp theo pattern này:

### Setup cơ bản

```js
// Trong facecap.js, sau khi load GLTF:
let mixer = null;
let idleAction = null;

function onGLTFLoaded(gltf) {
  state.modelRoot = gltf.scene;

  if (gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(state.modelRoot);
    idleAction = mixer.clipAction(gltf.animations[0]);
    idleAction.play();
  }
}

// Trong render loop (startRenderLoop):
function render() {
  requestAnimationFrame(render);
  const dt = clock.getDelta();   // hoặc dùng THREE.Timer
  mixer?.update(dt);             // update animation
  state.controls?.update();
  state.renderer?.render(state.scene, state.camera);
}
```

### Kết hợp face tracking + body animation

```
Face tracking (morph targets):
  → eyeBlink, mouthSmile, jawOpen...
  → setMorphTarget() mỗi frame

Head bone rotation:
  → setHeadRotation(pitch, yaw, roll)
  → trực tiếp set bone.rotation

Body animation (mixer):
  → mixer.update(dt) mỗi frame
  → xương thân/tay/chân chạy theo keyframe animation
  → head bone bị OVERRIDE bởi face tracking → OK vì face tracking set sau

Ưu tiên: Face tracking > AnimationMixer cho vùng mặt/đầu
          AnimationMixer độc quyền cho thân/tay/chân
```

### Gợi ý flow chuyển cảnh

```
Idle animation (loop)
  │ user nói chuyện
  ▼
crossFadeTo(talkGesture, 0.5s)
  │ câu nói kết thúc
  ▼
crossFadeTo(idle, 1.0s)
```

### Chú ý: Mirror L/R

Mixamo export model theo convention riêng. Khi blend animation với face tracking:
- Bone tên `mixamorigLeftArm` = tay trái của **nhân vật**
- Khác với convention `_L` / `_R` của morph targets (có đảo do camera mirror)
- Luôn kiểm tra bằng `SkeletonHelper` khi thêm animation mới

---

## Sơ đồ quan hệ các class

```
THREE.AnimationClip ──────────────────────────┐
  .name: string                               │
  .duration: number                           │
  .tracks: KeyframeTrack[]                    │
                                              ▼
THREE.AnimationMixer ──► clipAction() ──► THREE.AnimationAction
  .timeScale                                  .weight
  .update(dt)                                 .timeScale
  .stopAllAction()                            .paused
  .addEventListener('loop', cb)               .enabled
                                              .time
                                              .play()
                                              .stop()
                                              .reset()
                                              .fadeIn(d)
                                              .fadeOut(d)
                                              .crossFadeTo(action, d, warp)
                                              .setEffectiveWeight(w)
                                              .getEffectiveWeight()
```
