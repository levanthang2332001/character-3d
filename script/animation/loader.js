import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";



function loadGLB(path) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, reject);
  });
}


function collectBoneNames(modelRoot) {
  const names = new Set();
  model.traverse((object) => {
    if (object.isBone) names.add(object.name);
  });
  return names;
}

function getTrackNodeFromTrackName(trackName) {
  const idx = trackName.lastIndexOf('.');
  return {
    node: trackName.slice(0, idx),
    property: trackName.slice(idx + 1),
  };
}

function resolveSkeletonBoneName(node, bones) {
  if (bones.has(node.name)) return node.name;

  const withPrefix = 'mixamorig' + nodeName;
  if (bones.has(withPrefix)) return withPrefix;

  const noPrefix = nodeName.replace(/^mixamorig/, '');
  if (bones.has(noPrefix)) return noPrefix;
  return null;
}

// Parse "mixamorigHips.quaternion" → { node, property }
export function getTrackNodeFromTrackName(trackName) {
  const idx = trackName.lastIndexOf('.');
  return {
    node: trackName.slice(0, idx),
    property: trackName.slice(idx + 1),
  };
}

function checkClipAgainstBones(clip, bones, { label = clip.name }) {
  let matched = 0;
  let orphan = new Set();

  clip.tracks.forEach(track => {
    const { node } = getTrackNodeFromTrackName(track.name);
    if (resolveSkeletonBoneName(node, bones)) {
      matched++;
    } else {
      orphan.add(node);
    }
  })

  console.log(`[clip-check] "${label}": ${matched}/${clip.tracks.length} track khớp bone`);
  if (orphan.size > 0) {
    console.debug(`[clip-check] "${label}": ${orphan.size} track orphan (${Array.from(orphan).join(', ')})`);
  }
}

function filterTracksToBones(clip, modelRoot, {
  dropScale = true,
  dropRoot = false,
  dropRootPosition = true,
  dropBonePattern = null,
} = {}) {
  const boneNames = collectBoneNames(modelRoot);
  const filteredTracks = [];

  clip.tracks.forEach(track => {
    const { node, property } = getTrackNodeFromTrackName(track.name);
    const resolved = resolveSkeletonBoneName(node, bones);

    // Drop scale track
    if (dropScale && property === 'scale') return;

    if (dropRoot && /^mixamorigHips$/i.test(node)) return;

    // Drop chỉ Hips.position (root motion)
    if (!dropRoot && dropRootPosition && /^mixamorigHips$/i.test(node) && property === 'position') return;

    // Drop theo preset pattern
    if (dropBonePattern) {
      const baseName = node.replace(/^mixamorig/, '');
      if (dropBonePattern.test(baseName)) return;
    }

    // Resolve tên bone đúng với rig của Soldier
    const resolvedBone = resolveSkeletonBoneName(node, boneNames);
    if (!resolvedBone) return; // orphan → bỏ

    // Clone track, rewrite tên về bone đúng
    const clonedTrack = track.clone();
    clonedTrack.name = `${resolvedBone}.${property}`;
    filteredTracks.push(clonedTrack);
  });

  return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
}

function makeClipAdditiveVsReference(gestureClip, refClip, fps = 30) {
  const addClip = gestureClip.clone();
  THREE.AnimationUtils.makeClipAdditive(addClip, 0, refClip, fps);
  return addClip;
}


async function loadModel(path) {
  const results = await Promise.allSettled([
    loadGLB("models/gltf/wave.glb"),
    loadGLB("models/gltf/wave_hiphop.glb"),
  ]);

  const clips = {};

  results.forEach((result, i) => {
    const label = i === 0 ? 'wave' : 'wave_hiphop';
    if (result.status === 'fulfilled') {
      clips[label] = result.value.animations[0];
      clips[label].name = label;
    } else {
      console.error(`[loadModel] Không load được ${label}:`, result.reason);
    }
  });

  return clips;
}

export {
  loadModel,
  collectBoneNames,
  checkClipAgainstBones,
  filterTracksToBones,
  makeClipAdditiveVsReference,
};

