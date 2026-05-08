import * as THREE from "three";

const WAVE_CLIP_DURATION = 2.4;

const WAVE_ANGLES = {
  upperRaiseAxis: new THREE.Vector3(1, 0, 0),
  upperRaiseDeg: 180,

  foreSwingAxis: new THREE.Vector3(0, 0, 1),
  foreSwingMaxDeg: 30,
};

// In ra cả deg lẫn rad để dễ kiểm tra.
function logWaveAngles() {
  const a = WAVE_ANGLES;
  const r = THREE.MathUtils.degToRad;
  console.table({
    "upper raise (RightArm)": {
      axis: a.upperRaiseAxis.toArray().join(", "),
      deg: a.upperRaiseDeg,
      rad: r(a.upperRaiseDeg).toFixed(4),
    },
    "fore swing + (RightForeArm)": {
      axis: a.foreSwingAxis.toArray().join(", "),
      deg: +a.foreSwingMaxDeg,
      rad: r(+a.foreSwingMaxDeg).toFixed(4),
    },
    "fore swing - (RightForeArm)": {
      axis: a.foreSwingAxis.toArray().join(", "),
      deg: -a.foreSwingMaxDeg,
      rad: r(-a.foreSwingMaxDeg).toFixed(4),
    },
  });
}

// Tìm bone theo suffix
function findBoneBySuffix(root, suffix) {
  let found = null;
  root.traverse((obj) => {
    if (obj.isBone && obj.name.endsWith(suffix)) found = obj;
  });
  return found;
}

export function attachBoneAxes(root, suffix, size = 0.3) {
  const bone = findBoneBySuffix(root, suffix);
  if (!bone) {
    console.warn(`attachBoneAxes: bone with suffix "${suffix}" not found`);
    return null;
  }
  const axes = new THREE.AxesHelper(size);
  axes.name = `axes_${bone.name}`;
  // material gốc của AxesHelper bị skin/light ảnh hưởng → ép luôn render trên top.
  axes.material.depthTest = false;
  axes.material.depthWrite = false;
  axes.renderOrder = 999;
  bone.add(axes);
  return axes;
}

export function createWaveAction(mixer, root) {
  const upperArm = findBoneBySuffix(root, "RightArm");
  const foreArm = findBoneBySuffix(root, "RightForeArm");

  if (!upperArm || !foreArm) {
    console.warn("Could not find right arm or forearm bones");
    return null;
  }

  logWaveAngles();

  const baseUpper = upperArm.quaternion.clone();
  const baseFore = foreArm.quaternion.clone();

  // Tay giơ lên = baseUpper * rotation thêm
  const raisedUpper = baseUpper.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(
      WAVE_ANGLES.upperRaiseAxis,
      THREE.MathUtils.degToRad(WAVE_ANGLES.upperRaiseDeg)
    )
  );

  // Cẳng tay vẫy = baseFore * swing
  const swing = (deg) =>
    baseFore.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(
        WAVE_ANGLES.foreSwingAxis,
        THREE.MathUtils.degToRad(deg)
      )
    );

  const S = WAVE_ANGLES.foreSwingMaxDeg;
  const times = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4];

  // 7 keyframe cho cánh tay trên — số lượng phải khớp với `times`.
  const upperValues = [
    baseUpper, raisedUpper, raisedUpper, raisedUpper,
    raisedUpper, raisedUpper, baseUpper,
  ].flatMap((q) => q.toArray());

  // Cẳng tay vẫy qua-lại quanh ±S°.
  const foreValues = [
    baseFore, swing(+S), swing(-S), swing(+S),
    swing(-S), swing(0), baseFore,
  ].flatMap((q) => q.toArray());

  const clip = new THREE.AnimationClip("wave", WAVE_CLIP_DURATION, [
    new THREE.QuaternionKeyframeTrack(
      `${upperArm.name}.quaternion`,
      times,
      upperValues
    ),
    new THREE.QuaternionKeyframeTrack(
      `${foreArm.name}.quaternion`,
      times,
      foreValues
    ),
  ]);

  THREE.AnimationUtils.makeClipAdditive(clip);

  const action = mixer.clipAction(clip);
  action.blendMode = THREE.AdditiveAnimationBlendMode;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = false;
  return action;
}