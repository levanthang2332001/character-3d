import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import { EMOTIONS, emotionPresets } from "./constants.js";
import { createLipSyncController } from "./lip_sync.js";
import { applyEyeRotation } from "./eye_control.js";

// ─── Đường dẫn tài nguyên ───────────────────────────────────────────────────
const AVATAR_MODEL_PATH = "models/gltf/facecap.glb";
const BASIS_TRANSCODER_PATH = "./node_modules/three/examples/jsm/libs/basis/";

// ─── State toàn cục của module ───────────────────────────────────────────────
// Tất cả trạng thái được đóng gói trong object này, không dùng biến toàn cục
const state = {
  // Three.js core
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  // Avatar model references (được gán sau khi GLTF load xong)
  modelRoot: null,  // root node của cả model
  headMesh: null,  // mesh chứa morph targets (tên "mesh_2")
  leftEyeGroup: null,  // group xoay mắt trái ("grp_eyeLeft")
  rightEyeGroup: null,  // group xoay mắt phải ("grp_eyeRight")
  leftEyeBaseQuaternion: null,  // quaternion trung tính mắt trái (clone khi load)
  rightEyeBaseQuaternion: null,  // quaternion trung tính mắt phải (clone khi load)

  // Morph targets (blendshapes)
  morphTargetDictionary: null,  // { "jawOpen": 0, "mouthSmile_L": 1, ... }
  morphTargetInfluences: null,  // Float32Array, index tương ứng với dictionary

  // Emotion auto-cycle
  randomInterval: null,   // ID của setInterval khi đang chạy random emotion
  isAutoRunning: false,  // đang chạy random hay không

  // Debug GUI (lil-gui)
  debugGui: null,   // GUI instance
  eyeProxy: null,   // { lPitch, lYaw, rPitch, rYaw } — được setEyeRotation cập nhật live

  isInitialized: false,    // tránh khởi tạo 2 lần
};

const lipSyncController = createLipSyncController({ setMorphTarget });

export function initFacecap() {
  if (state.isInitialized) return;
  state.isInitialized = true;

  setupScene();
  setupRenderer();
  setupEnvironment();
  setupControls();
  loadAvatar();
  startRenderLoop();
  window.addEventListener("resize", handleResize);
}

export function setMorphTarget(name, value) {
  const morphIndex = getMorphIndex(name);
  if (morphIndex === undefined) return;
  state.morphTargetInfluences[morphIndex] = THREE.MathUtils.clamp(value, 0, 1);
}

export function resetAll() {
  if (!state.morphTargetDictionary || !state.morphTargetInfluences) return;
  for (const morphIndex of Object.values(state.morphTargetDictionary)) {
    state.morphTargetInfluences[morphIndex] = 0;
  }
}

export function getMorphTargetDictionary() {
  return state.morphTargetDictionary ?? {};
}

export function setHeadRotation(pitch = 0, yaw = 0, roll = 0) {
  if (!state.modelRoot) return;
  state.modelRoot.rotation.set(pitch, yaw, roll);
}

/**
 * Xoay mắt trái và phải (độc lập nhau).
 * Delegate sang eye_control.js để tách biệt logic.
 *
 * @param {number} leftPitch   - Pitch mắt trái
 * @param {number} leftYaw     - Yaw mắt trái
 * @param {number} rightPitch  - Pitch mắt phải (mặc định = leftPitch)
 * @param {number} rightYaw    - Yaw mắt phải (mặc định = leftYaw)
 */
export function setEyeRotation(leftPitch = 0, leftYaw = 0, rightPitch = leftPitch, rightYaw = leftYaw) {
  applyEyeRotation(state.leftEyeGroup, state.leftEyeBaseQuaternion, leftPitch, leftYaw);
  applyEyeRotation(state.rightEyeGroup, state.rightEyeBaseQuaternion, rightPitch, rightYaw);

  if (state.eyeProxy) {
    state.eyeProxy.lPitch = leftPitch;
    state.eyeProxy.lYaw = leftYaw;
    state.eyeProxy.rPitch = rightPitch;
    state.eyeProxy.rYaw = rightYaw;
  }
}

export function setEmotion(name, fromAuto = false) {
  stopRandomIfNeeded(fromAuto);
  clearActiveState("[data-emotion], #random");
  setElementActive(name);

  if (name === "random") return;

  resetAll();
  applyMorphPreset(emotionPresets[name]);
}

/**
 * Toggle chế độ tự động đổi cảm xúc mỗi 2 giây.
 * Nếu đang chạy thì dừng lại, nếu chưa thì bắt đầu.
 */
export function startRandom() {
  if (state.isAutoRunning) {
    stopRandom();
    return;
  }

  let emotionIndex = 0;
  const applyNextEmotion = () => {
    setEmotion(EMOTIONS[emotionIndex], true);
    emotionIndex = (emotionIndex + 1) % EMOTIONS.length;
  };

  applyNextEmotion();
  state.randomInterval = window.setInterval(applyNextEmotion, 2000);
  state.isAutoRunning = true;

  const randomButton = document.getElementById("random");
  if (randomButton) {
    randomButton.textContent = "Pause Auto";
    randomButton.classList.add("active");
  }
}

export function startSpeechFromText() {
  lipSyncController.startFromText();
}

export function isLipSyncActive() {
  return lipSyncController.isActive();
}

export function updateLipSyncCameraSignal(signal) {
  lipSyncController.updateCameraSignal(signal);
}

export function clearLipSyncCameraSignal() {
  lipSyncController.clearCameraSignal();
}

// ─── Private: Three.js Setup ─────────────────────────────────────────────────

function setupScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x666666);

  const axesHelper = new THREE.AxesHelper(2);
  state.scene.add(axesHelper);

  state.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 20);
  state.camera.position.set(0, 1, 3);
}

function setupRenderer() {
  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(window.devicePixelRatio);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping; // màu sắc tự nhiên hơn
  document.body.appendChild(state.renderer.domElement);
}

function setupEnvironment() {
  const pmremGenerator = new THREE.PMREMGenerator(state.renderer);
  state.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();
}

function setupControls() {
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;      // chuyển động mượt khi thả chuột
  state.controls.minDistance = 2.5;
  state.controls.maxDistance = 5;
  state.controls.minAzimuthAngle = -Math.PI / 2;  // giới hạn xoay ngang ±90°
  state.controls.maxAzimuthAngle = Math.PI / 2;
  state.controls.maxPolarAngle = Math.PI / 1.8;  // không cho xoay quá xuống
  state.controls.target.set(0, 0.2, 0);            // target hướng về vùng mặt
}

function loadAvatar() {
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(state.renderer);

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);

  loader.load(
    AVATAR_MODEL_PATH,
    (gltf) => {
      document.getElementById("loading")?.style.setProperty("display", "none");

      // Lấy node gốc của model
      state.modelRoot = gltf.scene.children[0] ?? gltf.scene;
      centerAvatar(state.modelRoot);
      state.scene.add(state.modelRoot);

      // Tìm mesh chứa morph targets theo tên cố định trong model
      state.headMesh = state.modelRoot.getObjectByName("mesh_2") ?? state.modelRoot;

      // Lấy group xoay của từng mắt và clone quaternion trung tính
      state.leftEyeGroup = state.modelRoot.getObjectByName("grp_eyeLeft");
      state.rightEyeGroup = state.modelRoot.getObjectByName("grp_eyeRight");
      state.leftEyeBaseQuaternion = state.leftEyeGroup?.quaternion.clone() ?? null;
      state.rightEyeBaseQuaternion = state.rightEyeGroup?.quaternion.clone() ?? null;

      // Morph targets: dictionary = { tên: index }, influences = Float32Array giá trị
      state.morphTargetInfluences = state.headMesh.morphTargetInfluences ?? null;
      state.morphTargetDictionary = state.headMesh.morphTargetDictionary ?? null;

      if (state.morphTargetDictionary && state.morphTargetInfluences) {
        createDebugGUI();
      }

      resetAll();
      setEyeRotation(0, 0, 0, 0);
    },
    undefined,
    (error) => {
      console.error(error);
      const loadingElement = document.getElementById("loading");
      if (loadingElement) loadingElement.textContent = "Error!";
    },
  );
}

// ─── Private: Render Loop ────────────────────────────────────────────────────

/** Vòng lặp render chính (60fps). Controls.update() cần để damping hoạt động. */
function startRenderLoop() {
  const render = () => {
    requestAnimationFrame(render);
    state.controls?.update();
    state.renderer?.render(state.scene, state.camera);
  };

  render();
}

/** Cập nhật aspect ratio và kích thước renderer khi window resize */
function handleResize() {
  if (!state.camera || !state.renderer) return;
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── Private: Avatar Positioning ─────────────────────────────────────────────

/**
 * Căn giữa avatar trong scene sau khi load.
 * Tính bounding box → dịch chuyển root về gốc tọa độ → cập nhật orbit target.
 *
 * @param {THREE.Object3D} root - Root node của model
 */
function centerAvatar(root) {
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());

  // Dịch về gốc: X và Z về 0, Y để chân model chạm đất (bounds.min.y = 0)
  root.position.x -= center.x;
  root.position.y -= bounds.min.y;
  root.position.z -= center.z;

  // Đặt orbit target vào vùng mặt (45% chiều cao model)
  const targetHeight = THREE.MathUtils.clamp(size.y * 0.45, 0.1, 0.6);
  state.controls?.target.set(0, targetHeight, 0);
  state.controls?.update();
}

// ─── Private: Debug GUI (lil-gui) ────────────────────────────────────────────

/**
 * Tạo debug GUI bằng lil-gui, bố cục giống ảnh tham khảo:
 *
 *  ▼ Controls
 *    Emotion     [dropdown]
 *    [Play all emotions]
 *    L Pitch  ───────────
 *    L Yaw    ───────────
 *    R Pitch  ───────────
 *    R Yaw    ───────────
 *  ▼ Blendshapes
 *    eyeBlink_L  ────────  (live, đọc thẳng từ morphTargetInfluences)
 *    ...
 *
 * Live-sync:
 *  - Eye bone: eyeProxy được setEyeRotation() cập nhật mỗi frame → .listen() tự refresh.
 *  - Morphs: JS Proxy với getter đọc trực tiếp từ Float32Array → .listen() luôn live.
 *
 * Phím G: toggle ẩn/hiện.
 */
function createDebugGUI() {
  if (!state.morphTargetDictionary || !state.morphTargetInfluences) return;
  if (state.debugGui) { state.debugGui.destroy(); state.debugGui = null; }

  const gui = new GUI({ title: "Debug", width: 260 });
  Object.assign(gui.domElement.style, {
    position: "fixed",
    top: "8px",
    left: "8px",
    zIndex: "9998",
  });

  // ── Controls folder ───────────────────────────────────────────────────────
  const ctrlFolder = gui.addFolder("Controls");

  // Emotion dropdown + Play all
  const ctrlProxy = {
    emotion: "neutral",
    "Play all emotions": () => startRandom(),
  };
  ctrlFolder
    .add(ctrlProxy, "emotion", ["neutral", ...EMOTIONS])
    .name("Emotion")
    .onChange((v) => setEmotion(v));
  ctrlFolder.add(ctrlProxy, "Play all emotions");

  // Eye bone rotation — live via .listen() + manual override khi tracking tắt
  const EYE_P = 0.28, EYE_Y = 0.72;
  const eyeProxy = { lPitch: 0, lYaw: 0, rPitch: 0, rYaw: 0 };
  state.eyeProxy = eyeProxy;
  const applyEye = () =>
    setEyeRotation(eyeProxy.lPitch, eyeProxy.lYaw, eyeProxy.rPitch, eyeProxy.rYaw);

  ctrlFolder.add(eyeProxy, "lPitch", -EYE_P, EYE_P, 0.001).name("L Pitch").listen().onChange(applyEye);
  ctrlFolder.add(eyeProxy, "lYaw", -EYE_Y, EYE_Y, 0.001).name("L Yaw").listen().onChange(applyEye);
  ctrlFolder.add(eyeProxy, "rPitch", -EYE_P, EYE_P, 0.001).name("R Pitch").listen().onChange(applyEye);
  ctrlFolder.add(eyeProxy, "rYaw", -EYE_Y, EYE_Y, 0.001).name("R Yaw").listen().onChange(applyEye);
  ctrlFolder.open();

  // ── Blendshapes folder ────────────────────────────────────────────────────
  // JS Proxy: getter/setter đọc-ghi thẳng vào Float32Array.
  // .listen() → lil-gui poll getter mỗi frame → số nhảy theo tracking live.
  const shortToIndex = {};
  for (const [name, idx] of Object.entries(state.morphTargetDictionary)) {
    shortToIndex[name.replace("blendShape1.", "")] = idx;
  }

  const liveProxy = new Proxy({}, {
    get(_, key) {
      const idx = shortToIndex[key];
      return idx !== undefined ? (state.morphTargetInfluences[idx] ?? 0) : 0;
    },
    set(_, key, value) {
      const idx = shortToIndex[key];
      if (idx !== undefined) state.morphTargetInfluences[idx] = value;
      return true;
    },
  });

  const bsFolder = gui.addFolder("Blendshapes");
  for (const short of Object.keys(shortToIndex).sort()) {
    bsFolder.add(liveProxy, short, 0, 1, 0.001).listen();
  }
  bsFolder.open();

  gui.add({ "Reset All": () => resetAll() }, "Reset All");

  state.debugGui = gui;

  // Phím G: toggle ẩn/hiện
  document.addEventListener("keydown", (e) => {
    if ((e.key === "g" || e.key === "G") &&
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA") {
      gui.domElement.style.display =
        gui.domElement.style.display === "none" ? "" : "none";
    }
  });
}

// ─── Private: Morph Target Helpers ───────────────────────────────────────────

/**
 * Áp dụng một preset morph (object tên → giá trị).
 * Dùng cho emotion presets.
 *
 * @param {Object} preset - vd: { "mouthSmile_L": 1, "mouthSmile_R": 1 }
 */
function applyMorphPreset(preset = {}) {
  for (const [name, value] of Object.entries(preset)) {
    setMorphTarget(name, value);
  }
}

/**
 * Lấy index của morph target theo tên.
 * @returns {number|undefined}
 */
function getMorphIndex(name) {
  return state.morphTargetDictionary?.[name];
}

// ─── Private: UI State Helpers ───────────────────────────────────────────────

/** Xóa class "active" khỏi tất cả element khớp selector */
function clearActiveState(selector) {
  document.querySelectorAll(selector).forEach((element) => element.classList.remove("active"));
}

/** Thêm class "active" vào element theo ID */
function setElementActive(elementId) {
  document.getElementById(elementId)?.classList.add("active");
}

// ─── Private: Random Emotion Helpers ─────────────────────────────────────────

/**
 * Dừng random nếu lời gọi đến từ bên ngoài (không phải từ chính vòng lặp random).
 * Tránh vòng lặp tự dừng chính nó.
 */
function stopRandomIfNeeded(fromAuto) {
  if (!state.randomInterval || fromAuto) return;
  stopRandom();
}

/** Dừng vòng lặp random và khôi phục UI button */
function stopRandom() {
  clearIntervalIfSet("randomInterval");
  state.isAutoRunning = false;

  const randomButton = document.getElementById("random");
  if (randomButton) {
    randomButton.textContent = "Random Auto";
    randomButton.classList.remove("active");
  }
}

/** Helper an toàn: clearInterval chỉ khi key tồn tại trong state */
function clearIntervalIfSet(key) {
  if (!state[key]) return;
  clearInterval(state[key]);
  state[key] = null;
}
