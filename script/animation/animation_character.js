import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createWaveAction, attachBoneAxes } from "./arm.js";
import {
  loadModel,
  collectBoneNames,
  checkClipAgainstBones,
  filterTracksToBones,
  makeClipAdditiveVsReference,
  retargetHipsRotation,
} from './loader.js';

// ─── ĐỔI CHARACTER TẠI ĐÂY ────────────────────────────────────────────────────
// 1. Đặt file GLB vào models/gltf/
// 2. Đổi AVATAR_MODEL_PATH
// 3. Reload trang → console log "[animations]" liệt kê tên + index tất cả clip
// 4. Cập nhật ANIMATION_INDEX theo index đúng từ log
const AVATAR_MODEL_PATH = "models/gltf/character.glb";

const BASIS_TRANSCODER_PATH = "./node_modules/three/examples/jsm/libs/basis/";
const ANIMATION_INDEX = {
  // [2] 1.07s ≈ idle breathing, [3] 0.77s ≈ walk cycle
  // Cập nhật nếu sau khi xem log [animations] thấy index khác
  idle: 2,
  walk: 3,
  run:  3,
};
// ──────────────────────────────────────────────────────────────────────────────

/** Preset drop-bone cho từng kiểu gesture.
 * - `upperBody`: vai/tay/đầu/cổ + Spine2 trở lên. Drop Hips (forward flip),
 *   Spine/Spine1 (cột sống dưới), nguyên chuỗi chân → đứng yên + idle drive.
 * - `fullBody`: drop Hips.position (root motion) qua cờ riêng — KHÔNG drop
 *   bone nào theo regex. Forward axis được fix bằng `retargetHipsRotation`
 *   trong `setupGestureActions` → cả chuỗi `Hips → UpLeg → Leg → Foot → Toe`
 *   áp đúng pose, chân nhảy đầy đủ theo clip. */
const GESTURE_DROP_PRESETS = {
  upperBody: /(Hips|Spine$|Spine1$|Leg|Foot|Toe)/i,
  // fullBody: không dùng dropBonePattern — giữ TẤT CẢ track (chỉ drop scale + Hips.position).
  // Dùng /(?!)/ thay null để tránh bug `null ?? upperBody` của toán tử ??.
  fullBody: /(?!)/,
};

const state = {
  scene: null,
  camera: null,
  renderer: null,

  // OrbitControls
  orbitControls: null,

  model: null,
  skeleton: null,
  mixer: null,

  idleAction: null,
  walkAction: null,
  runAction: null,

  actions: null,
  settings: {
    "modify idle weight": 1.0,
    "modify walk weight": 0.0,
    "modify run weight": 0.0,
  },

  singleStep: false,
  sizeOfNextStep: 0,

  isInitialized: false,

  // Arm
  waveAction: null,
  isWaving: false,
  onWaveFinished: null,

  // Debug helpers — AxesHelper gắn vào bone (đỏ X, xanh-lá Y, xanh-dương Z)
  boneAxes: [],

  gestureActions: {},
};

const crossFadeControls = [];


export function initAnimation() {
  if (state.isInitialized) return;
  state.isInitialized = true;

  setupScene();
  setRenderer();
  setupOrbitControls();
  setupTimer();
  setupLights();
  setupGround();
  setupLoader().catch((err) => console.error("[setupLoader] failed:", err));

  window.addEventListener("resize", handleResize);
}

function setupScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xa0a0a0);
  state.scene.fog = new THREE.Fog(0xa0a0a0, 10, 50);

  state.axisHelper = new THREE.AxesHelper(1);
  state.axisHelper.position.set(0, 0, 0);
  state.scene.add(state.axisHelper);

  state.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 100);
  state.camera.position.set(1, 2, -3);

  state.camera.lookAt(0, 1, 0);
}

function setRenderer() {
  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(window.devicePixelRatio);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // shadow map
  state.renderer.shadowMap.enabled = true;
  document.body.appendChild(state.renderer.domElement);
}

function setupOrbitControls() {
  const controls = new OrbitControls(state.camera, state.renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.update();

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  controls.minDistance = 1.5;
  controls.maxDistance = 18;

  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.15;

  controls.enablePan = false;

  state.orbitControls = controls;
}

function setupTimer() {
  state.timer = new THREE.Timer();
  state.timer.connect(document);
}

function setupLights() {
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 3);
  hemiLight.position.set(0, 20, 0);
  state.scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 3);
  dirLight.position.set(-3, 10, -10);
  dirLight.castShadow = true;
  dirLight.shadow.camera.top = 2;
  dirLight.shadow.camera.bottom = -2;
  dirLight.shadow.camera.left = -2;
  dirLight.shadow.camera.right = 2;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 40;

  dirLight.shadow.mapSize.set(2048, 2048);
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  dirLight.shadow.bias = -0.0001;
  state.scene.add(dirLight);
}
// Làm mặt đất để tạo bóng
function setupGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshPhongMaterial({ color: 0xcbcbcb, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  state.scene.add(ground);
}

/** Pipeline 5 bước biến `rawClip` (Mixamo) thành AnimationAction additive trên
 * mixer Soldier. Xem `docs/animation_gesture_overlay.md` §4 để hiểu chi tiết. */
function setupGestureActions(rawClip, label, refClip, preset, modelRoot) {
  if (!rawClip) {
    console.warn(`[gesture] "${label}": không có clip`);
    return null;
  }

  const dropPattern = GESTURE_DROP_PRESETS[preset] ?? GESTURE_DROP_PRESETS.upperBody;
  // Sanity: log để xác nhận preset + pattern mỗi lần register
  console.log(`[gesture] "${label}" preset=${preset} dropPattern=${dropPattern}`);
  const boneNames = collectBoneNames(modelRoot);

  // Bước 3: log mismatch để debug
  checkClipAgainstBones(rawClip, boneNames, { label: `gesture: ${label}` });

  // Bước 4: lọc track về đúng bone Soldier + drop theo preset
  const filtered = filterTracksToBones(rawClip, modelRoot, {
    dropScale: true,
    dropRoot: false,
    dropRootPosition: true,
    dropBonePattern: dropPattern,
  });
  if (filtered.tracks.length === 0) {
    console.warn(`[gesture] "${label}": clip rỗng sau khi lọc`);
    return null;
  }

  /** upperBody (wave):
   *   - `makeClipAdditiveVsReference` → delta so với idle, blend ADDITIVE, idle = 1.
   *   - Overlay tay/vai lên idle đang chạy. Không ảnh hưởng phần idle drive Hips/chân.
   *
   * fullBody (hiphop):
   *   - Soldier.glb VÀ wave_hiphop.glb đều là Mixamo rig → bone local frames GIỐNG nhau.
   *     Không cần retargetHipsRotation (áp offset sai làm Hips lệch cả clip → chân cứng).
   *   - Clip áp thẳng ở blend NORMAL, idle weight = 0 → clip ghi đè toàn skeleton.
   *   - Chỉ drop Hips.position để character đứng tại chỗ (không trượt sàn). */
  const useAdditive = preset !== "fullBody";
  const finalClip = useAdditive
    ? makeClipAdditiveVsReference(filtered, refClip, 30)
    : filtered;
  finalClip.name = label;

  const action = state.mixer.clipAction(finalClip);
  action.blendMode = useAdditive
    ? THREE.AdditiveAnimationBlendMode
    : THREE.NormalAnimationBlendMode;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = false;
  action.enabled = true;
  setWeight(action, 0);
  action.play(); // pre-play ở weight 0 → fadeIn lúc trigger

  state.gestureActions[label] = action;

  // Log số track chân còn lại để xác nhận không bị drop
  const legTracks = finalClip.tracks.filter((t) => /Leg|Foot|Toe/i.test(t.name));
  console.log(
    `[gesture] registered: "${label}" preset=${preset} blend=${useAdditive ? "additive" : "normal"}` +
    ` tracks=${finalClip.tracks.length} (loại ${filtered.dropped}) duration=${finalClip.duration.toFixed(2)}s` +
    ` legTracks=${legTracks.length}`
  );
  return action;
}

function playGesture(name) {
  if (state.activeGesture) {
    console.log(`[gesture] đang chạy "${state.activeGesture}", bỏ "${name}"`);
    return;
  }

  // Resolve action: imported (state.gestureActions) > procedural fallback (chỉ "wave")
  const action =
    state.gestureActions[name] ?? (name === "wave" ? state.waveAction : null);
  if (!action) {
    console.warn(`[playGesture] không tìm thấy gesture: "${name}"`);
    return;
  }

  const isAdditive = action.blendMode === THREE.AdditiveAnimationBlendMode;
  console.log(
    `[playGesture] "${name}" blendMode=${action.blendMode} isAdditive=${isAdditive}` +
    ` clip.tracks=${action.getClip().tracks.length}`
  );

  // Additive (upperBody): idle = 1 làm base, gesture cộng delta lên.
  // Normal (fullBody): idle = 0, gesture ghi đè toàn skeleton.
  setWeight(state.walkAction, 0);
  setWeight(state.runAction, 0);
  setWeight(state.idleAction, isAdditive ? 1 : 0);

  // Reset + fadeIn + play
  action.reset().setEffectiveWeight(1).fadeIn(0.3).play();
  state.activeGesture = name;

  // Listener "finished": dọn dẹp, restore locomotion
  state.onGestureFinished = (e) => {
    if (e.action !== action) return;

    state.mixer.removeEventListener('finished', state.onGestureFinished);
    action.fadeOut(0.3);
    state.activeGesture = null;

    // Restore về idle
    setWeight(state.idleAction, 1);
    console.log(`[gesture] finished: ${name}`);
  };

  state.mixer.addEventListener('finished', state.onGestureFinished);
}


async function setupLoader() {
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(state.renderer);

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);

  // 1. Load Soldier
  const gltf = await loader.loadAsync(AVATAR_MODEL_PATH);
  state.model = gltf.scene;
  state.scene.add(state.model);

  state.model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  // 2. Skeleton helper
  state.skeleton = new THREE.SkeletonHelper(state.model);
  state.skeleton.visible = false;
  state.scene.add(state.skeleton);

  // 3. Mixer + locomotion clips của Soldier
  state.mixer = new THREE.AnimationMixer(state.model);

  const animations = gltf.animations;

  // Log tất cả animation để xác nhận index khi đổi character
  console.log(
    "[animations]",
    animations.map((a, i) => `[${i}] "${a.name}" ${a.duration.toFixed(2)}s`)
  );

  const rawIdle = animations[ANIMATION_INDEX.idle];
  const rawWalk = animations[ANIMATION_INDEX.walk];
  const rawRun  = animations[ANIMATION_INDEX.run];

  if (!rawIdle) {
    console.error("[animation] idleClip không tìm thấy — kiểm tra ANIMATION_INDEX.idle");
    return;
  }

  // Remap bone names về mixamorig8:* (skeleton thật drive mesh).
  // Cần thiết khi GLB được export từ Blender với nhiều armature (mixamorig: vs mixamorig8:).
  const remapClip = (raw, label) => {
    if (!raw) return null;
    const clip = filterTracksToBones(raw, state.model, { dropScale: false, dropRootPosition: false });
    clip.name = label;
    console.log(`[animation] "${label}" remapped: ${clip.tracks.length}/${raw.tracks.length} tracks`);
    return clip;
  };

  const idleClip = remapClip(rawIdle, "idle");
  const walkClip = remapClip(rawWalk, "walk") ?? idleClip;
  const runClip  = remapClip(rawRun,  "run")  ?? walkClip;

  state.idleAction = state.mixer.clipAction(idleClip);
  state.walkAction = state.mixer.clipAction(walkClip);
  state.runAction  = state.mixer.clipAction(runClip);
  state.actions = [state.idleAction, state.walkAction, state.runAction];

  // 4. Procedural wave (fallback nếu wave.glb load fail)
  state.waveAction = createWaveAction(state.mixer, state.model);

  // 5. AxesHelper trên vài bone debug
  state.boneAxes = [
    attachBoneAxes(state.model, "RightArm", 0.25),
    attachBoneAxes(state.model, "RightForeArm", 0.2),
    attachBoneAxes(state.model, "RightHand", 0.15),
  ].filter(Boolean);
  state.boneAxes.forEach((a) => (a.visible = false));

  // 6. GUI panel + locomotion warm-up
  createPanel();
  activateAllActions();

  // 7. Bật render loop ngay — đừng chờ gesture clip mới render được
  state.renderer.setAnimationLoop(animate);

  // 8. Load gesture clips ngoài, register qua pipeline 5 bước.
  //    Soldier vẫn locomotion bình thường nếu gesture load chậm/lỗi.
  try {
    const gestureClips = await loadModel();

    if (gestureClips.wave) {
      setupGestureActions(gestureClips.wave, "wave", idleClip, "upperBody", state.model);
    }
    if (gestureClips.wave_hiphop) {
      setupGestureActions(
        gestureClips.wave_hiphop,
        "wave_hiphop",
        idleClip,
        "fullBody",
        state.model
      );
    }
  } catch (err) {
    console.warn("[gesture] load failed, dùng procedural wave:", err);
  }
}

function setWeight(action, weight) {
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(weight);
}

function animate() {
  // Timer is used instead of Clock to keep animation stepping predictable.
  state.timer.update();
  const dt = state.timer.getDelta();
  if (state.mixer) {
    let mixerDelta = dt;
    if (state.singleStep) {
      mixerDelta = state.sizeOfNextStep;
      state.sizeOfNextStep = 0;
    }
    state.mixer.update(mixerDelta);
  }

  if (state.orbitControls) state.orbitControls.update();

  state.renderer.render(state.scene, state.camera);
}

function handleResize() {
  if (!state.camera || !state.renderer) return;
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

function createPanel() {
  const panel = new GUI({ width: 310 });

  const folderVisibility = panel.addFolder('Visibility');
  const folderActivation = panel.addFolder('Activation/Deactivation');
  const folderStep = panel.addFolder('Pausing/Stepping');
  const folderCrossfading = panel.addFolder('Crossfading');
  const folderWeights = panel.addFolder('Blend Weights');
  const folderSpeed = panel.addFolder('General Speed');
  const folderGestures = panel.addFolder('Gestures');

  // GUI settings object is the single source of truth for panel bindings.
  state.settings = {
    "show model": true,
    "show skeleton": false,
    "deactivate all": deactivateAllActions,
    "activate all": activateAllActions,
    "pause/continue": pauseContinue,
    "make single step": toSingleStepMode,
    "modify step size": 0.05,
    "from walk to idle": () => {
      if (!state.walkAction || !state.idleAction) return;
      prepareCrossFade(state.walkAction, state.idleAction, 1.0);
    },
    "from idle to walk": () => {
      if (!state.idleAction || !state.walkAction) return;
      prepareCrossFade(state.idleAction, state.walkAction, 0.5);
    },
    "from walk to run": () => {
      if (!state.walkAction || !state.runAction) return;
      prepareCrossFade(state.walkAction, state.runAction, 2.5);
    },
    "from run to walk": () => {
      if (!state.runAction || !state.walkAction) return;
      prepareCrossFade(state.runAction, state.walkAction, 5.0);
    },
    "use default duration": true,
    "set custom duration": 3.5,
    "modify idle weight": 0.0,
    "modify walk weight": 1.0,
    "modify run weight": 0.0,
    "modify time scale": 1.0,
    "wave": () => playGesture("wave"),
    "wave_hiphop": () => playGesture("wave_hiphop"),
  };

  const settings = state.settings;

  folderVisibility.add(settings, "show model").onChange(showModel);
  folderVisibility.add(settings, "show skeleton").onChange(showSkeleton);

  folderActivation.add(settings, "deactivate all");
  folderActivation.add(settings, "activate all");

  folderStep.add(settings, "pause/continue");
  folderStep.add(settings, "make single step");
  folderStep.add(settings, "modify step size", 0.01, 0.1, 0.001);

  registerCrossFadeControls(folderCrossfading, settings);
  folderCrossfading.add(settings, "use default duration");
  folderCrossfading.add(settings, "set custom duration", 0, 10, 0.01);

  registerWeightControls(folderWeights, settings);

  folderSpeed
    .add(settings, "modify time scale", 0.0, 1.5, 0.01)
    .onChange(modifyTimeScale);

  folderGestures.add(settings, "wave");
  folderGestures.add(settings, "wave_hiphop");

  openPanelFolders([
    folderVisibility,
    folderActivation,
    folderStep,
    folderCrossfading,
    folderWeights,
    folderSpeed,
    folderGestures,
  ]);
}

function registerCrossFadeControls(folderCrossfading, settings) {
  crossFadeControls.push(folderCrossfading.add(settings, "from walk to idle"));
  crossFadeControls.push(folderCrossfading.add(settings, "from idle to walk"));
  crossFadeControls.push(folderCrossfading.add(settings, "from walk to run"));
  crossFadeControls.push(folderCrossfading.add(settings, "from run to walk"));
}

function registerWeightControls(folderWeights, settings) {
  folderWeights.add(settings, "modify idle weight", 0.0, 1.0, 0.01).listen().onChange((weight) => {
    if (!state.idleAction) return;
    setWeight(state.idleAction, weight);
  });

  folderWeights.add(settings, "modify walk weight", 0.0, 1.0, 0.01).listen().onChange((weight) => {
    if (!state.walkAction) return;
    setWeight(state.walkAction, weight);
  });

  folderWeights.add(settings, "modify run weight", 0.0, 1.0, 0.01).listen().onChange((weight) => {
    if (!state.runAction) return;
    setWeight(state.runAction, weight);
  });
}

function openPanelFolders(folders) {
  folders.forEach((folder) => folder.open());
}

function prepareCrossFade(startAction, endAction, defaultDuration) {
  // Respect user's default/custom crossfade duration from GUI.
  const duration = setCrossFadeDuration(defaultDuration);
  state.singleStep = false;
  unPauseAllActions();
  if (startAction === state.idleAction) {
    executeCrossFade(startAction, endAction, duration);
  } else {
    synchronizeCrossFade(startAction, endAction, duration);
  }
}

function setCrossFadeDuration(defaultDuration) {
  if (state.settings["use default duration"]) return defaultDuration;
  return state.settings["set custom duration"];
}

function executeCrossFade(startAction, endAction, duration) {
  setWeight(endAction, 1);
  endAction.time = 0;
  startAction.crossFadeTo(endAction, duration, true);
}

function synchronizeCrossFade(startAction, endAction, duration) {
  state.mixer.addEventListener("loop", function onLoop(event) {
    if (event.action === startAction) {
      state.mixer.removeEventListener("loop", onLoop);
      executeCrossFade(startAction, endAction, duration);
    }
  });
}

function deactivateAllActions() {
  // Nếu thực sự action.stop() tất cả, mixer không drive bone nữa và bone rơi
  // về bind pose của Vanguard = T-pose (tay giang ngang) — không phải hành vi
  // người dùng kỳ vọng. Thay vào đó: dừng walk/run, giữ idle ở weight 1 để
  // nhân vật đứng yên với 2 tay xuôi.
  state.walkAction.stop();
  state.runAction.stop();
  setWeight(state.idleAction, 1);
  state.idleAction.play();
}

function activateAllActions() {
  setWeight(state.idleAction, state.settings["modify idle weight"]);
  setWeight(state.walkAction, state.settings["modify walk weight"]);
  setWeight(state.runAction, state.settings["modify run weight"]);

  state.actions.forEach((action) => {
    action.play();
  });
}

function pauseContinue() {
  if (state.singleStep) {
    state.singleStep = false;
    unPauseAllActions();
    return;
  }
  if (state.idleAction.paused) {
    unPauseAllActions();
  } else {
    pauseAllActions();
  }
}

function pauseAllActions() {
  state.actions.forEach((action) => {
    action.paused = true;
  });
}

function toSingleStepMode() {
  unPauseAllActions();
  state.singleStep = true;
  state.sizeOfNextStep = state.settings["modify step size"];
}

function unPauseAllActions() {
  state.actions.forEach((action) => {
    action.paused = false;
  });
}

function showModel(visibility) {
  state.model.visible = visibility;
}

function showSkeleton(visibility) {
  state.skeleton.visible = visibility;
}

function showBoneAxes(visibility) {
  state.boneAxes.forEach((axes) => {
    axes.visible = visibility;
  });
}

function modifyTimeScale(speed) {
  state.mixer.timeScale = speed;
}

