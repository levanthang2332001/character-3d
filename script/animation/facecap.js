import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

const AVATAR_MODEL_PATH = "models/gltf/Soldier.glb";
const BASIS_TRANSCODER_PATH = "./node_modules/three/examples/jsm/libs/basis/";
const ANIMATION_INDEX = {
  idle: 0,
  run: 1,
  walk: 3,
};

const state = {
  scene: null,
  camera: null,
  renderer: null,

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
};

const crossFadeControls = [];


export function initAnimation() {
  if (state.isInitialized) return;
  state.isInitialized = true;

  setupScene();
  setRenderer();
  setupTimer();
  setupLights();
  setupLoader();

  window.addEventListener("resize", handleResize);
}

function setupScene() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xa0a0a0);
  state.scene.fog = new THREE.Fog(0xa0a0a0, 10, 50);

  state.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 100);
  state.camera.position.set(1, 2, -3);

  state.camera.lookAt(0, 1, 0);
}

function setRenderer() {
  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(window.devicePixelRatio);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(state.renderer.domElement);
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
  state.scene.add(dirLight);
}

function setupLoader() {
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(state.renderer);

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);

  loader.load(AVATAR_MODEL_PATH, (gltf) => {
    state.model = gltf.scene;
    state.scene.add(state.model);

    state.model.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });

    // Skeleton helper
    state.skeleton = new THREE.SkeletonHelper(state.model);
    state.skeleton.visible = false;
    state.scene.add(state.skeleton);

    state.mixer = new THREE.AnimationMixer(state.model);

    createPanel();

    const animations = gltf.animations;
    state.idleAction = state.mixer.clipAction(animations[ANIMATION_INDEX.idle]);
    state.walkAction = state.mixer.clipAction(animations[ANIMATION_INDEX.walk]);
    state.runAction = state.mixer.clipAction(animations[ANIMATION_INDEX.run]);

    state.actions = [state.idleAction, state.walkAction, state.runAction];

    activateAllActions();

    state.renderer.setAnimationLoop(animate);
  });
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
  if (state.mixer) state.mixer.update(dt);
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

  openPanelFolders([
    folderVisibility,
    folderActivation,
    folderStep,
    folderCrossfading,
    folderWeights,
    folderSpeed,
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
  // Wait until current loop ends before crossfading to keep transitions smooth.
  state.mixer.addEventListener("loop", function onLoop(event) {
    if (event.action === startAction) {
      state.mixer.removeEventListener("loop", onLoop);
      executeCrossFade(startAction, endAction, duration);
    }
  });
}

function deactivateAllActions() {
  state.actions.forEach((action) => {
    action.stop();
  });
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
  state.mixer.paused = !state.mixer.paused;
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

function modifyTimeScale(speed) {
  state.mixer.timeScale = speed;
}
