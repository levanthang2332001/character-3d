import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import Stats from "three/addons/libs/stats.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PATHS = {
  avatar: "models/remy/Character.glb",
  idle: "models/remy/Idle.glb",
  walk: "models/remy/Walk.glb",
  runGlbOptional: "",
  ktx2Basis: "./node_modules/three/examples/jsm/libs/basis/",
};

const RUN_SPEED_VS_WALK = 2.35;

const SCENE = {
  background: 0xa0a0a0,
  fogNear: 10,
  fogFar: 50,
};

const CAMERA = {
  fov: 45,
  near: 1,
  far: 100,
  position: Object.freeze([0, 1.65, 4.2]),
  lookAt: Object.freeze([0, 1, 0]),
};

const ORBIT = {
  target: Object.freeze([0, 1, 0]),
  damping: 0.08,
  minDistance: 1.5,
  maxDistance: 15,
};

const GROUND = {
  size: 100,
  color: 0xcbcbcb,
};

const AXES = {
  size: 1.25,
  y: 0.01,
};

const LIGHT = {
  hemi: { sky: 0xffffff, ground: 0x8d8d8d, intensity: 3, y: 20 },
  dir: {
    color: 0xffffff,
    intensity: 3,
    position: Object.freeze([4, 12, 6]),
    target: Object.freeze([0, 1, 0]),
    shadowMapSize: 2048,
    shadowExtent: 6,
    shadowBias: -0.0002,
    shadowNormalBias: 0.035,
    shadowNear: 0.5,
    shadowFar: 40,
  },
};

const state = {
  scene: null,
  camera: null,
  renderer: null,

  axesHelper: null,
  ground: null,

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

  singleStepMode: false,
  sizeOfNextStep: 0,
  timer: null,
  stats: null,
  controls: null,

  runUsesWalkClip: false,
  isInitialized: false,
};

export function initAnimation() {
  if (state.isInitialized) return;
  state.isInitialized = true;

  initSceneGraph();
  initRenderer();
  initViewControls();
  initTimer();
  initLights();
  startAssetLoad();

  window.addEventListener("resize", onWindowResize);
}

function initSceneGraph() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(SCENE.background);
  state.scene.fog = new THREE.Fog(
    SCENE.background,
    SCENE.fogNear,
    SCENE.fogFar,
  );

  const cam = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );
  cam.position.fromArray(CAMERA.position);
  cam.lookAt(new THREE.Vector3().fromArray(CAMERA.lookAt));
  state.camera = cam;

  addGroundPlane();
  addAxesHelper();
}

function addGroundPlane() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.size, GROUND.size),
    new THREE.MeshPhongMaterial({ color: GROUND.color, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  state.scene.add(mesh);
  state.ground = mesh;
}

function addAxesHelper() {
  const axes = new THREE.AxesHelper(AXES.size);
  axes.position.y = AXES.y;
  state.scene.add(axes);
  state.axesHelper = axes;
}

function initRenderer() {
  const container = getContainerElement();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  state.renderer = renderer;

  const stats = new Stats();
  container.appendChild(stats.dom);
  state.stats = stats;
}

function getContainerElement() {
  return document.getElementById("container") ?? document.body;
}

function initViewControls() {
  const controls = new OrbitControls(state.camera, state.renderer.domElement);
  controls.target.fromArray(ORBIT.target);
  controls.enableDamping = true;
  controls.dampingFactor = ORBIT.damping;
  controls.minDistance = ORBIT.minDistance;
  controls.maxDistance = ORBIT.maxDistance;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.update();
  state.controls = controls;
}

function initTimer() {
  const timer = new THREE.Timer();
  timer.connect(document);
  state.timer = timer;
}

function initLights() {
  const hemiCfg = LIGHT.hemi;
  const hemi = new THREE.HemisphereLight(
    hemiCfg.sky,
    hemiCfg.ground,
    hemiCfg.intensity,
  );
  hemi.position.set(0, hemiCfg.y, 0);
  state.scene.add(hemi);

  const dirCfg = LIGHT.dir;
  const dir = new THREE.DirectionalLight(dirCfg.color, dirCfg.intensity);
  dir.position.fromArray(dirCfg.position);
  dir.castShadow = true;
  dir.shadow.mapSize.set(dirCfg.shadowMapSize, dirCfg.shadowMapSize);
  dir.shadow.camera.near = dirCfg.shadowNear;
  dir.shadow.camera.far = dirCfg.shadowFar;
  const ext = dirCfg.shadowExtent;
  dir.shadow.camera.left = -ext;
  dir.shadow.camera.right = ext;
  dir.shadow.camera.top = ext;
  dir.shadow.camera.bottom = -ext;
  dir.shadow.bias = dirCfg.shadowBias;
  dir.shadow.normalBias = dirCfg.shadowNormalBias;

  dir.target.position.fromArray(dirCfg.target);
  state.scene.add(dir);
  state.scene.add(dir.target);
}

function createConfiguredGltfLoader() {
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(PATHS.ktx2Basis).detectSupport(state.renderer);

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function clipWithFallbackName(clip, fallbackName) {
  if (!clip) {
    throw new Error(
      "Missing animation clip (file may be empty or incompatible).",
    );
  }
  const c = clip.clone();
  c.name = !c.name || c.name === "mixamo.com" ? fallbackName : c.name;
  return c;
}

function stripRootHipsMotion(clip) {
  const tracks = clip.tracks.filter(
    (track) => !isMixamoRootHipsPositionTrack(track.name),
  );
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function isMixamoRootHipsPositionTrack(trackName) {
  if (!trackName.endsWith(".position")) return false;
  return /(^|\.)(mixamorigHips|mixamorig:Hips)\.position$/i.test(trackName);
}

function buildClipsFromAssets(idleGltf, walkGltf, optionalRunGltf) {
  const idleClip = stripRootHipsMotion(
    clipWithFallbackName(idleGltf.animations[0], "Idle"),
  );
  const walkClip = stripRootHipsMotion(
    clipWithFallbackName(walkGltf.animations[0], "Walk"),
  );

  const runClip = optionalRunGltf?.animations?.[0]
    ? stripRootHipsMotion(
        clipWithFallbackName(optionalRunGltf.animations[0], "Run"),
      )
    : clipWithFallbackName(walkClip.clone(), "Run");

  state.runUsesWalkClip = !optionalRunGltf;

  return { idleClip, walkClip, runClip };
}

// -----------------------------------------------------------------------------
// Loader → character + mixer
// -----------------------------------------------------------------------------

function startAssetLoad() {
  const gltfLoader = createConfiguredGltfLoader();

  void (async () => {
    try {
      const loads = [
        gltfLoader.loadAsync(PATHS.avatar),
        gltfLoader.loadAsync(PATHS.idle),
        gltfLoader.loadAsync(PATHS.walk),
      ];

      if (PATHS.runGlbOptional) {
        loads.push(gltfLoader.loadAsync(PATHS.runGlbOptional));
      }

      const results = await Promise.all(loads);
      const characterGltf = results[0];
      const idleGltf = results[1];
      const walkGltf = results[2];
      const optionalRunGltf = PATHS.runGlbOptional ? results[3] : null;

      mountCharacter(characterGltf.scene);

      state.mixer = new THREE.AnimationMixer(state.model);
      createGuiPanel();

      const { idleClip, walkClip, runClip } = buildClipsFromAssets(
        idleGltf,
        walkGltf,
        optionalRunGltf,
      );

      state.idleAction = state.mixer.clipAction(idleClip);
      state.walkAction = state.mixer.clipAction(walkClip);
      state.runAction = state.mixer.clipAction(runClip);
      state.actions = [state.idleAction, state.walkAction, state.runAction];

      activateAllActions();
      state.renderer.setAnimationLoop(renderFrame);
    } catch (err) {
      console.error("Failed to load character or animation clips:", err);
    }
  })();
}

function mountCharacter(sceneRoot) {
  state.model = sceneRoot;
  state.scene.add(state.model);

  state.model.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });

  state.skeleton = new THREE.SkeletonHelper(state.model);
  state.skeleton.visible = false;
  state.scene.add(state.skeleton);
}

// -----------------------------------------------------------------------------
// Render loop
// -----------------------------------------------------------------------------

function renderFrame() {
  if (!state.timer || !state.idleAction) {
    state.renderer.render(state.scene, state.camera);
    state.stats?.update();
    return;
  }

  state.timer.update();

  const idleW = state.idleAction.getEffectiveWeight();
  const walkW = state.walkAction.getEffectiveWeight();
  const runW = state.runAction.getEffectiveWeight();
  syncGuiWeightSliders(idleW, walkW, runW);

  let delta = state.timer.getDelta();
  if (state.singleStepMode) {
    delta = state.sizeOfNextStep;
    state.sizeOfNextStep = 0;
  }

  state.mixer.update(delta);

  if (state.runUsesWalkClip && state.runAction?.getEffectiveWeight() > 0) {
    state.runAction.setEffectiveTimeScale(RUN_SPEED_VS_WALK);
  }

  state.controls?.update();
  state.renderer.render(state.scene, state.camera);
  state.stats?.update();
}

function syncGuiWeightSliders(idleWeight, walkWeight, runWeight) {
  const s = state.settings;
  if (!s) return;
  s["modify idle weight"] = idleWeight;
  s["modify walk weight"] = walkWeight;
  s["modify run weight"] = runWeight;
}

function onWindowResize() {
  if (!state.camera || !state.renderer) return;
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// -----------------------------------------------------------------------------
// Mixer: weight & crossfade
// -----------------------------------------------------------------------------

function setWeight(action, weight) {
  action.enabled = true;
  const scale =
    state.runUsesWalkClip && action === state.runAction ? RUN_SPEED_VS_WALK : 1;
  action.setEffectiveTimeScale(scale);
  action.setEffectiveWeight(weight);
}

function prepareCrossFade(startAction, endAction, defaultDuration) {
  const duration = resolveCrossFadeDuration(defaultDuration);
  state.singleStepMode = false;
  unPauseAllActions();

  if (startAction === state.idleAction) {
    executeCrossFade(startAction, endAction, duration);
  } else {
    synchronizeCrossFade(startAction, endAction, duration);
  }
}

function resolveCrossFadeDuration(defaultDuration) {
  return state.settings["use default duration"]
    ? defaultDuration
    : state.settings["set custom duration"];
}

function executeCrossFade(startAction, endAction, duration) {
  setWeight(endAction, 1);
  endAction.time = 0;
  startAction.crossFadeTo(endAction, duration, false);
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
  state.actions.forEach((a) => a.stop());
}

function activateAllActions() {
  setWeight(state.idleAction, state.settings["modify idle weight"]);
  setWeight(state.walkAction, state.settings["modify walk weight"]);
  setWeight(state.runAction, state.settings["modify run weight"]);
  state.actions.forEach((a) => a.play());
}

function pauseContinue() {
  if (state.singleStepMode) {
    state.singleStepMode = false;
    unPauseAllActions();
    return;
  }
  if (!state.idleAction) return;

  if (state.idleAction.paused) unPauseAllActions();
  else pauseAllActions();
}

function pauseAllActions() {
  state.actions?.forEach((a) => {
    a.paused = true;
  });
}

function toSingleStepMode() {
  unPauseAllActions();
  state.singleStepMode = true;
  state.sizeOfNextStep = state.settings["modify step size"];
}

function unPauseAllActions() {
  state.actions?.forEach((a) => {
    a.paused = false;
  });
}

function modifyTimeScale(speed) {
  state.mixer.timeScale = speed;
}

// -----------------------------------------------------------------------------
// lil-gui
// -----------------------------------------------------------------------------

function createGuiPanel() {
  const panel = new GUI({ width: 310 });

  const folderVisibility = panel.addFolder("Visibility");
  const folderActivation = panel.addFolder("Activation/Deactivation");
  const folderStep = panel.addFolder("Pausing/Stepping");
  const folderCrossfading = panel.addFolder("Crossfading");
  const folderWeights = panel.addFolder("Blend Weights");
  const folderSpeed = panel.addFolder("General Speed");

  state.settings = {
    "show model": true,
    "show axes": true,
    "show ground plane": true,
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

  const s = state.settings;

  folderVisibility.add(s, "show model").onChange((v) => {
    state.model.visible = v;
  });
  folderVisibility.add(s, "show axes").onChange((v) => {
    if (state.axesHelper) state.axesHelper.visible = v;
  });
  folderVisibility.add(s, "show ground plane").onChange((v) => {
    if (state.ground) state.ground.visible = v;
  });
  folderVisibility.add(s, "show skeleton").onChange((v) => {
    state.skeleton.visible = v;
  });

  folderActivation.add(s, "deactivate all");
  folderActivation.add(s, "activate all");

  folderStep.add(s, "pause/continue");
  folderStep.add(s, "make single step");
  folderStep.add(s, "modify step size", 0.01, 0.1, 0.001);

  folderCrossfading.add(s, "from walk to idle");
  folderCrossfading.add(s, "from idle to walk");
  folderCrossfading.add(s, "from walk to run");
  folderCrossfading.add(s, "from run to walk");
  folderCrossfading.add(s, "use default duration");
  folderCrossfading.add(s, "set custom duration", 0, 10, 0.01);

  bindWeightSliders(folderWeights);

  folderSpeed
    .add(s, "modify time scale", 0.0, 1.5, 0.01)
    .onChange(modifyTimeScale);

  [
    folderVisibility,
    folderActivation,
    folderStep,
    folderCrossfading,
    folderWeights,
    folderSpeed,
  ].forEach((f) => f.open());
}

function bindWeightSliders(folderWeights) {
  const s = state.settings;

  folderWeights
    .add(s, "modify idle weight", 0.0, 1.0, 0.01)
    .listen()
    .onChange((w) => {
      if (state.idleAction) setWeight(state.idleAction, w);
    });
  folderWeights
    .add(s, "modify walk weight", 0.0, 1.0, 0.01)
    .listen()
    .onChange((w) => {
      if (state.walkAction) setWeight(state.walkAction, w);
    });
  folderWeights
    .add(s, "modify run weight", 0.0, 1.0, 0.01)
    .listen()
    .onChange((w) => {
      if (state.runAction) setWeight(state.runAction, w);
    });
}
