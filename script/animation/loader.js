import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Promise wrapper cho `GLTFLoader.load`. */
function loadGLB(path) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, reject);
  });
}

/** Parse `"mixamorigHips.quaternion"` → `{ node, property }`. */
export function getTrackNodeFromTrackName(trackName) {
  const idx = trackName.lastIndexOf(".");
  return {
    node: idx >= 0 ? trackName.slice(0, idx) : trackName,
    property: idx >= 0 ? trackName.slice(idx + 1) : "",
  };
}

/**
 * Tập tên bone từ skeleton drive mesh thật (SkinnedMesh.skeleton.bones).
 *
 * Dùng SkinnedMesh.skeleton thay vì traverse toàn bộ isBone để tránh thu thập
 * bone từ các extra armature (Blender export nhiều skin) không gắn mesh —
 * những bone đó tên trùng với clip tracks → resolveSkeletonBoneName map nhầm,
 * animation không drive được mesh chính.
 *
 * Fallback: nếu scene không có SkinnedMesh (pure Object3D rig) → dùng isBone.
 */
export function collectBoneNames(modelRoot) {
  const names = new Set();

  modelRoot.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      o.skeleton.bones.forEach((b) => { if (b.name) names.add(b.name); });
    }
  });

  if (names.size === 0) {
    // Fallback cho rig không có SkinnedMesh
    modelRoot.traverse((o) => {
      if (o.isBone && o.name) names.add(o.name);
    });
  }

  return names;
}

/**
 * Map `nodeName` từ track của clip sang một bone thật trên skeleton đích.
 *
 * Xử lý mọi variant prefix Mixamo gặp thực tế:
 *   mixamorigHips        (Soldier, wave.glb — standard)
 *   mixamorig:Hips       (Blender multi-armature export, colon separator)
 *   mixamorig8:Hips      (Blender numbered armature, e.g. character.glb)
 *   Hips                 (bare, sau khi strip)
 *
 * Thuật toán: strip bất kỳ `mixamorig<digits>:?` prefix → bare name →
 * thử tất cả prefix hiện có trên skeleton → fuzzy fallback theo bare name.
 */
export function resolveSkeletonBoneName(nodeName, boneNames) {
  if (boneNames.has(nodeName)) return nodeName;

  // Strip variant: mixamorig8:, mixamorig:, mixamorig8, mixamorig
  const bare = nodeName.replace(/^mixamorig\d*:?/i, "");

  if (boneNames.has(bare)) return bare;

  // Thử ghép các prefix phổ biến
  const candidates = [
    `mixamorig8:${bare}`,
    `mixamorig:${bare}`,
    `mixamorig${bare}`,
    `mixamorig8${bare}`,
  ];
  for (const c of candidates) {
    if (boneNames.has(c)) return c;
  }

  // Fuzzy: tìm bone nào có bare name khớp (bất kể prefix)
  for (const b of boneNames) {
    if (b.replace(/^mixamorig\d*:?/i, "") === bare) return b;
  }

  return null;
}

/**
 * Đối chiếu mọi track trong clip với tập bone — biết track nào PropertyBinding
 * sẽ tìm thấy node. Log tóm tắt + danh sách orphan node (mức `console.debug`
 * vì leaf bone mismatch là chuyện bình thường với clip Mixamo).
 */
export function checkClipAgainstBones(clip, boneNames, { label = clip?.name ?? "clip" } = {}) {
  let matched = 0;
  const orphan = new Set();

  for (const track of clip.tracks) {
    const { node } = getTrackNodeFromTrackName(track.name);
    if (resolveSkeletonBoneName(node, boneNames)) matched++;
    else orphan.add(node);
  }

  console.log(`[clip-check] "${label}": ${matched}/${clip.tracks.length} track khớp bone`);
  if (orphan.size > 0) {
    console.debug(
      `[clip-check] "${label}": ${orphan.size} track bỏ qua (node không có trên rig):`,
      [...orphan].sort()
    );
  }
}

/**
 * Lọc track sao cho mọi node tồn tại trên skeleton đích (đồng thời rewrite
 * `track.name` về đúng `bone.name`). Trả **clip mới** — không mutate gốc.
 *
 * - `dropScale` (default true): bỏ track scale, tránh skin lệch khi mismatch.
 * - `dropRoot` (default false): bỏ TẤT CẢ track của bone Hips (cả position
 *   lẫn quaternion). Hips của clip Mixamo thường chứa rotation forward khác
 *   convention với rig đích → bị lật 180° khi blend.
 * - `dropRootPosition` (default true): bỏ `Hips.position` (root motion) → nhân
 *   vật không trượt sàn. Bị bỏ qua khi `dropRoot=true`.
 * - `dropBonePattern` (RegExp, optional): drop luôn track có node match.
 *   Pattern test trên tên đã strip `mixamorig` (ví dụ `Hips`, `LeftUpLeg`).
 */
export function filterTracksToBones(clip, modelRoot, {
  dropScale = true,
  dropRoot = false,
  dropRootPosition = true,
  dropBonePattern = null,
} = {}) {
  const boneNames = collectBoneNames(modelRoot);
  const filteredTracks = [];
  let dropped = 0;

  for (const track of clip.tracks) {
    const { node, property } = getTrackNodeFromTrackName(track.name);
    const baseName = node.replace(/^mixamorig/i, "");
    const isHips = /^Hips$/i.test(baseName);

    if (dropScale && property === "scale") {
      dropped++;
      continue;
    }
    if (dropRoot && isHips) {
      dropped++;
      continue;
    }
    if (!dropRoot && dropRootPosition && isHips && property === "position") {
      dropped++;
      continue;
    }
    if (dropBonePattern && dropBonePattern.test(baseName)) {
      dropped++;
      continue;
    }

    const resolved = resolveSkeletonBoneName(node, boneNames);
    if (!resolved) {
      dropped++;
      continue;
    }

    const cloned = track.clone();
    cloned.name = `${resolved}.${property}`;
    filteredTracks.push(cloned);
  }

  const out = new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
  out.dropped = dropped; // nhúng metadata để log ngoài callsite
  return out;
}

/**
 * Biến clip thành **additive** so với clip tham chiếu (idle Soldier).
 * Gesture frame 0 ≈ identity → blend không lật khi cộng lên base pose.
 * Trả **bản clone** — clip gốc không bị mutate, có thể tái sử dụng.
 *
 * @param {THREE.AnimationClip} gestureClip Clip đã filter + rewrite name.
 * @param {THREE.AnimationClip} refClip Clip pose tham chiếu (cùng rig).
 * @param {number} [fps=30]
 */
export function makeClipAdditiveVsReference(gestureClip, refClip, fps = 30) {
  const addClip = gestureClip.clone();
  THREE.AnimationUtils.makeClipAdditive(addClip, 0, refClip, fps);
  return addClip;
}

/**
 * Retarget rotation của Hips trong `clip` để khớp forward axis của `refClip`.
 *
 * Mixamo lưu `Hips.quaternion` so với rig nguồn (forward axis có thể khác
 * Soldier). Áp trực tiếp lên Soldier → toàn thân lật 180°. Hàm này:
 *
 *   1. Lấy `A = clip.Hips.quaternion[0]` và `B = refClip.Hips.quaternion[0]`.
 *   2. Tính `offset = B * A⁻¹`.
 *   3. Pre-multiply mọi keyframe trong clip's Hips track: `q' = offset * q`.
 *
 * Sau bước này: `clip.Hips[0] = B` (đúng pose ref), các frame sau dịch theo
 * cùng coordinate frame → `UpLeg/Leg/Foot/Toe` (rotation local so với Hips)
 * cũng tự nhiên về đúng vị trí, không cần retarget riêng.
 *
 * Mutate `clip` tại chỗ và return. No-op nếu clip/ref không có Hips.quaternion.
 */
export function retargetHipsRotation(clip, refClip) {
  const hipsRe = /Hips\.quaternion$/i;
  const clipTrack = clip.tracks.find((t) => hipsRe.test(t.name));
  const refTrack = refClip.tracks.find((t) => hipsRe.test(t.name));
  if (!clipTrack || !refTrack) return clip;

  const A = new THREE.Quaternion(
    clipTrack.values[0],
    clipTrack.values[1],
    clipTrack.values[2],
    clipTrack.values[3]
  );
  const B = new THREE.Quaternion(
    refTrack.values[0],
    refTrack.values[1],
    refTrack.values[2],
    refTrack.values[3]
  );

  // offset = B * A⁻¹ → q'₀ = offset * A = B
  const offset = new THREE.Quaternion().multiplyQuaternions(
    B,
    new THREE.Quaternion().copy(A).invert()
  );

  const v = clipTrack.values;
  const tmp = new THREE.Quaternion();
  for (let i = 0; i < v.length; i += 4) {
    tmp.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(offset);
    v[i] = tmp.x;
    v[i + 1] = tmp.y;
    v[i + 2] = tmp.z;
    v[i + 3] = tmp.w;
  }
  return clip;
}

/**
 * Load tất cả gesture clip ngoài (`wave.glb`, `wave_hiphop.glb`).
 * Dùng `Promise.allSettled` để file lỗi không kéo theo file kia.
 * Trả map `{ wave?, wave_hiphop? }` — key vắng mặt nếu file đó load fail.
 */
export async function loadModel() {
  const sources = [
    { key: "wave", path: "models/gltf/wave.glb" },
    { key: "wave_hiphop", path: "models/gltf/wave_hiphop.glb" },
  ];

  const results = await Promise.allSettled(sources.map((s) => loadGLB(s.path)));

  const clips = {};
  results.forEach((result, i) => {
    const { key, path } = sources[i];
    if (result.status !== "fulfilled") {
      console.error(`[loadModel] không load được ${path}:`, result.reason);
      return;
    }
    const animations = result.value.animations ?? [];
    if (animations.length === 0) {
      console.warn(`[loadModel] ${path}: GLB không chứa animation`);
      return;
    }
    // Chọn clip dài nhất — Mixamo thường chỉ có 1 nhưng phòng trường hợp nhiều.
    const clip = animations.reduce((a, b) => (b.duration > a.duration ? b : a));
    clip.name = key;
    clips[key] = clip;
  });

  return clips;
}
