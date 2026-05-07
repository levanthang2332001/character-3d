import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

const AVATAR_MODEL_PATH = "models/gltf/Soldier.glb";
const BASIS_TRANSCODER_PATH = "./node_modules/three/examples/jsm/libs/basis/";

const state = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  model: null,
  skeleton: null,
  mixer: null,
  timeline: null,

  idleAction: null,
  walkAction: null,
  runAction: null,

  idleWeight: 0,
  walkWeight: 0,
  runWeight: 0,

  actions: null,
  settings: {
    "modify idle weight": 1.0,
    "modify walk weight": 0.0,
    "modify run weight": 0.0,
  },

  singleStep: false,
  sizeOfNextStep: 0,

  isInitialized: false,
}

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

  const axesHelper = new THREE.AxesHelper(2);
  state.scene.add(axesHelper);

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

    console.log("model loaded", gltf);

    state.model.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });

    // Skeleton helper
    state.skeleton = new THREE.SkeletonHelper(state.model);
    state.skeleton.visible = false;
    state.scene.add(state.skeleton);

    state.mixer = new THREE.AnimationMixer(state.model);

    // createPanel();

    const animations = gltf.animations;

    // Actions
    state.idleAction = state.mixer.clipAction(animations[0]);
    state.walkAction = state.mixer.clipAction(animations[3]);
    state.runAction = state.mixer.clipAction(animations[1]);

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

/**
 * 
 * @description Create a panel for the animation system
 */
function createPanel() {
  const panel = new GUI({ width: 310 });

  const folderVisibility = panel.addFolder('Visibility');
  const folderActivation = panel.addFolder('Activation/Deactivation');
  const folderStep = panel.addFolder('Pausing/Stepping');
  const folderCrossfading = panel.addFolder('Crossfading');
  const folderWeights = panel.addFolder('Blend Weights');
  const folderSpeed = panel.addFolder('General Speed');

  state.settings = {
    "show model": true,
    "show skeleton": false,
    "deactivate all": deactivateAllActions,
    "activate all": activateAllActions,
    "pause/continue": pauseContinue,
    "make single step": toSingleStepMode,
    "modify step size": 0.05,
    "use default duration": true,
    "set custom duration": 3.5,
    "modify idle weight": 0.0,
    "modify walk weight": 1.0,
    "modify run weight": 0.0,
    "modify time scale": 1.0,
  };

  const settings = state.settings;

  folderVisibility.add(settings, 'show model').onChange(showModel);
  folderVisibility.add(settings, 'show skeleton').onChange(showSkeleton);

  folderActivation.add(settings, 'deactivate all');
  folderActivation.add(settings, 'activate all');

  folderStep.add(settings, 'pause/continue');
  folderStep.add(settings, 'make single step');
  folderStep.add(settings, 'modify step size', 0.01, 0.1, 0.001);

  folderCrossfading.add(settings, 'use default duration');
  folderCrossfading.add(settings, 'set custom duration', 0, 10, 0.01);

  const transitions = [
    { key: "from walk to idle", action: state.walkAction, target: state.idleAction, duration: 1.0 },
    { key: "from idle to walk", action: state.idleAction, target: state.walkAction, duration: 0.5 },
    { key: "from walk to run", action: state.walkAction, target: state.runAction, duration: 2.5 },
    { key: "from run to walk", action: state.runAction, target: state.walkAction, duration: 5.0 },
  ]

  transitions.forEach((t) => {
    settings[t.key] = () => {
      const startAction = t.from();
      const endAction = t.to();

      if (!startAction || !endAction) return;
      prepareCrossFade(startAction, endAction, t.duration);
    }
    folderCrossfading.add(settings, t.key);
  });


  folderCrossfading.add(settings, "use default duration");
  folderCrossfading.add(settings, "set custom duration", 0, 10, 0.01);

  addWeightSlider("modify idle weight", () => state.idleAction);
  addWeightSlider("modify walk weight", () => state.walkAction);
  addWeightSlider("modify run weight", () => state.runAction);
  folderSpeed
    .add(settings, "modify time scale", 0.0, 1.5, 0.01)
    .onChange(modifyTimeScale);

  folderVisibility.open();
  folderActivation.open();
  folderStep.open();
  folderCross.open();
  folderWeights.open();
  folderSpeed.open();
}

function addWeightSlider(label, getAction) {
  folderWeights
    .add(settings, label, 0.0, 1.0, 0.01)
    .listen()
    .onChange((weight) => {
      const action = getAction();
      if (!action) return;
      setWeight(action, weight);
    });
}

// 
function deactivateAllActions() {
  state.actions.forEach((action) => {
    action.stop()
  });
}
function activateAllActions() {
  setWeight(state.idleAction, state.settings['modify idle weight']);
  setWeight(state.walkAction, state.settings['modify walk weight']);
  setWeight(state.runAction, state.settings['modify run weight']);

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
  state.sizeOfNextStep = state.settings['modify step size'];
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
