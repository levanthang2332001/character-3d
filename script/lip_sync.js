/**
 * lip_sync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controller lip sync tiếng Việt cho avatar 3D.
 *
 * Cách hoạt động:
 *  1. Nhận text tiếng Việt từ input
 *  2. Phân tích âm tiết → tạo timeline viseme (thời gian của từng hình miệng)
 *  3. Phát âm thanh qua Web Speech API (SpeechSynthesis)
 *  4. Chạy animation loop đọc timeline → áp morph target lên model
 *  5. Đồng bộ với SpeechSynthesis qua sự kiện "boundary" để không bị lệch
 *  6. Pha trộn với tín hiệu camera (nếu đang tracking) để tự nhiên hơn
 *
 * Kiến trúc Viseme (đơn vị hình miệng):
 *  - "onset"   : phụ âm đầu âm tiết (m, b, p, qu...)
 *  - "nucleus" : nguyên âm chính (A, E, I, O, U, AW)
 *  - "coda"    : âm cuối (m, p = đóng môi; u/o = tròn môi)
 *  - "release" : khoảng nghỉ giữa các âm tiết
 *
 * Diphthong (nguyên âm đôi) được tách thành 2 viseme liên tiếp:
 *  Ví dụ: "iê" → ["I", "E"], "uô" → ["U", "O"]
 *
 * Camera blend:
 *  Khi camera tracking đang chạy, tín hiệu miệng từ camera được pha trộn
 *  vào viseme để môi trông "sống động" hơn, phản ứng theo giọng nói thật.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from "three";
import { LIP_SYNC_MORPH_TARGETS, lipSyncPresets } from "./constants.js";

/**
 * Factory tạo một lip sync controller độc lập.
 * Dùng factory pattern thay vì class để dễ inject dependency.
 *
 * @param {{ setMorphTarget: Function }} deps - Dependency injection
 * @returns {{ clearCameraSignal, isActive, startFromText, updateCameraSignal }}
 */
export function createLipSyncController({ setMorphTarget }) {
  // ─── State nội bộ của controller ──────────────────────────────────────────
  const state = {
    lipSyncFrame:               null,   // requestAnimationFrame ID
    lipSyncTimeline:            [],     // mảng segment { kind, viseme, start, end, weight, tokenIndex }
    lipSyncTokens:              [],     // mảng token { index, value, charStart, charEnd }
    lipSyncStartTime:           0,      // performance.now() lúc bắt đầu timeline
    lipSyncLastAlignedTokenIndex: -1,   // index token cuối đã được đồng bộ qua boundary event
    lipSyncCurrentValues:       {},     // giá trị morph hiện tại (để lerp)
    liveCameraMouthValues:      {},     // tín hiệu miệng từ camera tracking
    liveCameraMouthUpdatedAt:   0,      // performance.now() lúc nhận tín hiệu camera cuối
    speechUtterance:            null,   // SpeechSynthesisUtterance đang phát
    isLipSyncPlaying:           false,  // đang phát hay không
  };

  // ─── Public methods ────────────────────────────────────────────────────────

  /**
   * Đọc text từ input #speak-input và bắt đầu lip sync.
   * Tạo timeline → phát TTS → animation loop chạy song song.
   */
  function startFromText() {
    const input  = document.getElementById("speak-input");
    const button = document.getElementById("speak-btn");
    const status = document.getElementById("lip-sync-status");
    const text   = input?.value?.trim() ?? "";

    console.log("LipSync startFromText called, text:", text);
    if (!button) {
      console.log("No button found");
      return;
    }

    // Hủy bất kỳ phát âm cũ nào
    window.speechSynthesis.cancel();
    stopPlayback(false);

    console.log("speechSynthesis available:", !!window.speechSynthesis);
    console.log("speechSynthesis paused:", window.speechSynthesis?.paused);

    if (!text) {
      if (status) status.textContent = "Nhap cau tieng Viet de bat dau lip sync.";
      return;
    }

    // Tạo timeline viseme từ text
    const lipSyncData = createVietnameseLipSyncTimeline(text);
    if (!lipSyncData.timeline.length) {
      if (status) status.textContent = "Khong tao duoc timeline lip sync.";
      return;
    }

    // Tạo utterance TTS tiếng Việt
    const utterance  = new SpeechSynthesisUtterance(text);
    utterance.lang   = "vi-VN";
    utterance.rate   = 1;
    state.speechUtterance = utterance;
    startTimeline(lipSyncData);

    button.textContent = "Dang phat...";
    button.disabled    = true;
    button.classList.add("active");
    if (status) status.textContent = `Dang lip sync ${lipSyncData.tokens.length} tu theo giong doc.`;

    // Đồng bộ hóa timeline khi TTS báo boundary (đến ranh giới từ)
    utterance.onboundary = (event) => {
      synchronizeToBoundary(event.charIndex);
    };

    utterance.onend = () => {
      console.log("Speech ended");
      stopPlayback();
    };

    utterance.onerror = (e) => {
      console.error("Speech error:", e);
      if (status) status.textContent = "Trinh duyet khong phat duoc giong vi-VN.";
      stopPlayback();
    };

    console.log("Calling speechSynthesis.speak");
    window.speechSynthesis.speak(utterance);
    console.log("speechSynthesis.speak called");
  }

  /** Trả về true nếu đang phát lip sync */
  function isActive() {
    return state.isLipSyncPlaying;
  }

  /**
   * Nhận tín hiệu miệng từ camera (được gọi mỗi frame khi face tracking active).
   * @param {{ values: Object }} signal - Giá trị morph target từ camera
   */
  function updateCameraSignal(signal) {
    state.liveCameraMouthValues    = signal?.values ?? {};
    state.liveCameraMouthUpdatedAt = performance.now();
  }

  /** Xóa tín hiệu camera (khi tắt face tracking) */
  function clearCameraSignal() {
    state.liveCameraMouthValues    = {};
    state.liveCameraMouthUpdatedAt = 0;
  }

  // ─── Private: Timeline Playback ───────────────────────────────────────────

  /**
   * Bắt đầu animation loop phát timeline viseme.
   * Mỗi tick: tìm segment hiện tại → áp preset morph tương ứng.
   *
   * @param {{ timeline: Array, tokens: Array }} lipSyncData
   */
  function startTimeline(lipSyncData) {
    stopPlayback(false); // dừng cái cũ trước

    state.isLipSyncPlaying              = true;
    state.lipSyncTimeline               = lipSyncData.timeline;
    state.lipSyncTokens                 = lipSyncData.tokens;
    state.lipSyncStartTime              = performance.now();
    state.lipSyncLastAlignedTokenIndex  = -1;
    state.lipSyncCurrentValues          = {};

    const tick = (now) => {
      if (!state.isLipSyncPlaying) return;

      const elapsed       = now - state.lipSyncStartTime;
      const activeSegment = getTimelineSegmentAtTime(elapsed, state.lipSyncTimeline);

      // Lấy preset morph của viseme hiện tại (fallback về "rest" nếu không có segment)
      const targetPreset  = lipSyncPresets[activeSegment?.viseme] ?? lipSyncPresets.rest;
      const emphasis      = activeSegment?.weight ?? 1;  // weight nhỏ hơn = mở miệng ít hơn
      applyPreset(targetPreset, emphasis);

      // Tiếp tục loop ngay cả khi hết timeline (chờ TTS kết thúc trigger stopPlayback)
      if (elapsed >= getTimelineDuration(state.lipSyncTimeline)) {
        applyPreset(lipSyncPresets.rest, 1); // về trạng thái nghỉ
        state.lipSyncFrame = requestAnimationFrame(tick);
        return;
      }

      state.lipSyncFrame = requestAnimationFrame(tick);
    };

    state.lipSyncFrame = requestAnimationFrame(tick);
  }

  /**
   * Dừng phát và reset tất cả state.
   * @param {boolean} restoreUi - true = khôi phục nút UI về trạng thái ban đầu
   */
  function stopPlayback(restoreUi = true) {
    if (state.lipSyncFrame) {
      cancelAnimationFrame(state.lipSyncFrame);
      state.lipSyncFrame = null;
    }

    state.isLipSyncPlaying             = false;
    state.lipSyncTimeline              = [];
    state.lipSyncTokens                = [];
    state.lipSyncStartTime             = 0;
    state.lipSyncLastAlignedTokenIndex = -1;
    state.speechUtterance              = null;
    state.lipSyncCurrentValues         = {};
    clearCameraSignal();
    applyPreset(lipSyncPresets.rest, 1); // đặt miệng về trạng thái nghỉ

    if (!restoreUi) return;

    const button = document.getElementById("speak-btn");
    const status = document.getElementById("lip-sync-status");
    if (button) {
      button.textContent = "Lip Sync";
      button.disabled    = false;
      button.classList.remove("active");
    }
    if (status) {
      status.textContent = "San sang lip sync tieng Viet theo cau nhap.";
    }
  }

  // ─── Private: Morph Application ───────────────────────────────────────────

  /**
   * Áp một preset morph lên tất cả morph targets lip sync, có lerp và camera blend.
   *
   * Camera blend: nếu camera tracking vừa cập nhật (<180ms ago), pha trộn giá trị
   * camera vào để môi trông thực hơn khi người dùng thực sự nói.
   *
   * @param {Object} preset   - Morph preset từ constants.js
   * @param {number} emphasis - Nhân hệ số [0,1] để điều chỉnh biên độ
   */
  function applyPreset(preset, emphasis = 1) {
    const cameraBlendWeight = getCameraMouthBlendWeight();

    for (const targetName of LIP_SYNC_MORPH_TARGETS) {
      const visemeValue  = (preset[targetName] ?? 0) * emphasis;
      const cameraValue  = state.liveCameraMouthValues[targetName] ?? visemeValue;

      // Pha trộn: 0 = chỉ dùng viseme, 0.85 = thiên về camera
      const desiredValue  = THREE.MathUtils.lerp(visemeValue, cameraValue, cameraBlendWeight);
      const currentValue  = state.lipSyncCurrentValues[targetName] ?? 0;
      const smoothedValue = THREE.MathUtils.lerp(currentValue, desiredValue, 0.34);

      state.lipSyncCurrentValues[targetName] = smoothedValue;
      setMorphTarget(targetName, smoothedValue < 0.01 ? 0 : smoothedValue);
    }
  }

  /**
   * Tính trọng số pha trộn camera (0 = không dùng camera, 0.85 = ưu tiên camera).
   *
   * Điều kiện dùng camera:
   *  1. Tín hiệu camera mới hơn 180ms
   *  2. Miệng đang hoạt động (jawOpen / funnel / pucker > 0)
   *
   * @returns {number} [0, 0.85]
   */
  function getCameraMouthBlendWeight() {
    const signalAge = performance.now() - state.liveCameraMouthUpdatedAt;
    if (signalAge > 180) return 0; // tín hiệu quá cũ → không tin cậy

    // Đo mức độ hoạt động của miệng từ camera
    const activity = Math.max(
      state.liveCameraMouthValues.jawOpen      ?? 0,
      state.liveCameraMouthValues.mouthFunnel  ?? 0,
      state.liveCameraMouthValues.mouthPucker  ?? 0,
      state.liveCameraMouthValues.mouthSmile_L ?? 0,
      state.liveCameraMouthValues.mouthSmile_R ?? 0,
      state.liveCameraMouthValues.mouthPress_L ?? 0,
      state.liveCameraMouthValues.mouthPress_R ?? 0,
    );

    // Càng hoạt động nhiều → càng tin camera hơn (từ 0.25 lên 0.85)
    return THREE.MathUtils.clamp(0.25 + activity * 0.6, 0, 0.85);
  }

  // ─── Private: Speech Boundary Synchronization ─────────────────────────────

  /**
   * Được gọi khi TTS báo đến ranh giới từ (boundary event).
   * Tìm token tương ứng và điều chỉnh timeline để đồng bộ.
   *
   * @param {number} charIndex - Vị trí ký tự trong chuỗi text gốc
   */
  function synchronizeToBoundary(charIndex) {
    if (!state.isLipSyncPlaying || !state.lipSyncTokens.length) return;

    const token = state.lipSyncTokens.find(
      (entry) => charIndex >= entry.charStart && charIndex < entry.charEnd,
    );
    if (!token) return;
    if (token.index <= state.lipSyncLastAlignedTokenIndex) return; // đã đồng bộ rồi

    const actualElapsed = performance.now() - state.lipSyncStartTime;
    alignTimelineFromToken(token.index, actualElapsed);
    state.lipSyncLastAlignedTokenIndex = token.index;
  }

  /**
   * Dịch chuyển tất cả segment từ tokenIndex trở đi theo delta thời gian.
   * Mục tiêu: timeline khớp với thời điểm TTS thực sự đang đọc đến token đó.
   * Bỏ qua nếu delta < 12ms (quá nhỏ, không đáng điều chỉnh).
   *
   * @param {number} tokenIndex    - Index token cần đồng bộ
   * @param {number} actualElapsed - Thời gian thực đã trôi qua (ms)
   */
  function alignTimelineFromToken(tokenIndex, actualElapsed) {
    const firstSegmentIndex = state.lipSyncTimeline.findIndex(
      (segment) => segment.tokenIndex === tokenIndex
    );
    if (firstSegmentIndex === -1) return;

    const delta = actualElapsed - state.lipSyncTimeline[firstSegmentIndex].start;
    if (Math.abs(delta) < 12) return;

    // Dịch chuyển tất cả segment từ token này trở đi
    for (const segment of state.lipSyncTimeline) {
      if (segment.tokenIndex < tokenIndex) continue;
      segment.start += delta;
      segment.end   += delta;
    }
  }

  // ─── Return public interface ───────────────────────────────────────────────
  return {
    clearCameraSignal,
    isActive,
    startFromText,
    updateCameraSignal,
  };
}

// ─── Timeline Helpers (module-level, không phụ thuộc state) ──────────────────

/**
 * Tìm segment đang active tại thời điểm `time`.
 * Trả về null nếu không có segment nào bao gồm thời điểm đó (khoảng nghỉ giữa segment).
 */
function getTimelineSegmentAtTime(time, timeline) {
  return timeline.find((segment) => time >= segment.start && time < segment.end) ?? null;
}

/** Thời điểm kết thúc của timeline (end của segment cuối cùng) */
function getTimelineDuration(timeline) {
  return timeline.at(-1)?.end ?? 0;
}

// ─── Vietnamese Lip Sync Timeline Builder ────────────────────────────────────

/**
 * Tạo timeline viseme từ text tiếng Việt.
 * Quy trình: tokenize → tạo segments cho từng âm tiết → nối thành timeline.
 *
 * @param {string} text
 * @returns {{ timeline: Array, tokens: Array }}
 */
function createVietnameseLipSyncTimeline(text) {
  const timeline = [];
  const tokens   = tokenizeVietnameseText(text);
  let cursor     = 0;

  for (const token of tokens) {
    const segments = createSyllableSegments(token.value, cursor, token.index);
    timeline.push(...segments);
    cursor = segments.at(-1)?.end ?? cursor;
  }

  if (!timeline.length) {
    return { timeline: [], tokens };
  }

  // Thêm segment nghỉ cuối (120ms) để miệng đóng lại trước khi kết thúc
  timeline.push({
    kind:    "rest",
    viseme:  "rest",
    start:   cursor,
    end:     cursor + 120,
    weight:  1,
  });

  return { timeline, tokens };
}

/**
 * Tách text thành các token (từ/âm tiết), bỏ qua dấu câu và khoảng trắng.
 * Lưu charStart/charEnd để dùng cho boundary synchronization.
 *
 * @param {string} text
 * @returns {Array<{ index, value, charStart, charEnd }>}
 */
function tokenizeVietnameseText(text) {
  const tokens  = [];
  const matches = text.matchAll(/[^\s.,!?;:()"]+/g);
  let index     = 0;

  for (const match of matches) {
    const rawValue = match[0]?.trim();
    if (!rawValue) continue;

    tokens.push({
      index,
      value:     rawValue.toLowerCase(),
      charStart: match.index ?? 0,
      charEnd:   (match.index ?? 0) + rawValue.length,
    });
    index += 1;
  }

  return tokens;
}

/**
 * Tạo danh sách segment viseme cho một âm tiết tiếng Việt.
 *
 * Cấu trúc âm tiết tiếng Việt: (onset)(nucleus)(coda)(release)
 *  - onset:   phụ âm đầu (tùy chọn)   → ~16% thời lượng
 *  - nucleus: nguyên âm chính          → ~64% thời lượng (có thể có diphthong)
 *  - coda:    âm cuối (tùy chọn)       → ~20% thời lượng
 *  - release: khoảng nghỉ cố định 34ms (luôn có)
 *
 * @param {string} syllable     - Âm tiết (lowercase, đã normalize)
 * @param {number} startOffset  - Thời điểm bắt đầu (ms)
 * @param {number} tokenIndex   - Index token để tracking đồng bộ
 * @returns {Array<Segment>}
 */
function createSyllableSegments(syllable, startOffset, tokenIndex) {
  const totalDuration  = estimateSyllableDuration(syllable);
  const onsetViseme    = getOnsetViseme(syllable);
  const nucleusVisemes = getNucleusVisemes(syllable);
  const codaViseme     = getCodaViseme(syllable);
  const segments       = [];
  let cursor           = startOffset;

  // Onset: phụ âm đầu (m, b, p, qu)
  if (onsetViseme) {
    const onsetDuration = Math.max(36, totalDuration * 0.16);
    segments.push({
      kind:       "onset",
      tokenIndex,
      viseme:     onsetViseme,
      start:      cursor,
      end:        cursor + onsetDuration,
      weight:     0.75, // mở miệng không hết cỡ ở phụ âm
    });
    cursor += onsetDuration;
  }

  // Nucleus: nguyên âm (có thể là diphthong → 2 segment)
  const nucleusDuration = Math.max(90, totalDuration * 0.64);
  const unitDuration    = nucleusDuration / Math.max(nucleusVisemes.length, 1);
  for (const viseme of nucleusVisemes) {
    segments.push({
      kind:       "nucleus",
      tokenIndex,
      viseme,
      start:      cursor,
      end:        cursor + unitDuration,
      weight:     1, // mở miệng hết cỡ ở nguyên âm
    });
    cursor += unitDuration;
  }

  // Coda: âm cuối (m/p = đóng môi, u/o = tròn môi)
  if (codaViseme) {
    const codaDuration = Math.max(40, totalDuration * 0.2);
    segments.push({
      kind:       "coda",
      tokenIndex,
      viseme:     codaViseme,
      start:      cursor,
      end:        cursor + codaDuration,
      weight:     codaViseme === "M" ? 1 : 0.7, // M = đóng hoàn toàn, còn lại nhẹ hơn
    });
    cursor += codaDuration;
  }

  // Release: khoảng nghỉ giữa âm tiết
  segments.push({
    kind:       "release",
    tokenIndex,
    viseme:     "rest",
    start:      cursor,
    end:        cursor + 34,
    weight:     0.5,
  });

  return segments;
}

// ─── Duration Estimation ──────────────────────────────────────────────────────

/**
 * Ước tính thời lượng phát âm của một âm tiết (ms).
 * Nguyên âm nhiều → dài hơn, phụ âm nhiều → dài thêm ít.
 * Clamp vào [170, 340] ms cho hợp lý.
 */
function estimateSyllableDuration(syllable) {
  const baseDuration     = 150;
  const vowelBonus       = countVietnameseVowels(syllable) * 24;
  const consonantBonus   = Math.max(syllable.length - countVietnameseVowels(syllable), 0) * 10;
  return THREE.MathUtils.clamp(baseDuration + vowelBonus + consonantBonus, 170, 340);
}

function countVietnameseVowels(syllable) {
  return [...syllable].filter((character) => isVietnameseVowel(character)).length;
}

// ─── Viseme Mapping ───────────────────────────────────────────────────────────

/**
 * Map âm tiết tiếng Việt sang viseme chính dựa trên nguyên âm cuối cùng.
 * Nguyên âm tiếng Việt có dấu (NFD/precomposed) đều được nhận diện.
 */
function getVisemeForVietnameseSyllable(syllable) {
  // Nguyên âm đôi đặc biệt "oa/oă/oe" → AW (miệng tròn rộng)
  if (syllable.includes("oa") || syllable.includes("oă") || syllable.includes("oe")) return "AW";

  const characters = [...syllable];

  // Duyệt từ cuối vì nguyên âm quan trọng nhất thường gần cuối âm tiết
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if ("aăâáàảãạắằẳẵặấầẩẫậ".includes(character)) return "A";
    if ("eêéèẻẽẹếềểễệ".includes(character))         return "E";
    if ("iíìỉĩịyýỳỷỹỵ".includes(character))          return "I";
    if ("oôơóòỏõọốồổỗộớờởỡợ".includes(character))   return "O";
    if ("uưúùủũụứừửữự".includes(character))           return "U";
  }

  if (endsWithClosedLipConsonant(syllable)) return "M";
  return "rest";
}

/** Kiểm tra một ký tự có phải nguyên âm tiếng Việt không */
function isVietnameseVowel(character) {
  return "aăâáàảãạắằẳẵặấầẩẫậeêéèẻẽẹếềểễệiíìỉĩịoôơóòỏõọốồổỗộớờởỡợuưúùủũụứừửữựyýỳỷỹỵ"
    .includes(character);
}

/** Kiểm tra âm tiết có kết thúc bằng phụ âm đóng môi (b, m, p) không */
function endsWithClosedLipConsonant(syllable) {
  return /[bmp]$/.test(syllable);
}

/**
 * Xác định viseme onset (phụ âm đầu) của âm tiết.
 * Chỉ nhận diện các phụ âm ảnh hưởng hình miệng rõ ràng.
 */
function getOnsetViseme(syllable) {
  if (/^(m|b|p)/.test(syllable)) return "M"; // môi chạm nhau
  if (/^(qu)/.test(syllable))    return "U"; // môi tròn nhẹ
  return null; // phụ âm khác không ảnh hưởng hình miệng đáng kể
}

/**
 * Xác định viseme nucleus (nguyên âm) của âm tiết.
 * Diphthong (nguyên âm đôi) trả về mảng 2 viseme để animate chuyển tiếp.
 */
function getNucleusVisemes(syllable) {
  // Diphthong → 2 viseme
  if (/(iê|yê|ia|ya)/.test(syllable)) return ["I", "E"];
  if (/(ươ|ưa)/.test(syllable))        return ["U", "AW"];
  if (/(uô|ua)/.test(syllable))        return ["U", "O"];
  if (/(oa|oă)/.test(syllable))        return ["O", "A"];
  if (/(oe)/.test(syllable))           return ["O", "E"];
  if (/(uy|ui)/.test(syllable))        return ["U", "I"];
  if (/(uê)/.test(syllable))           return ["U", "E"];
  if (/(ai|ay|ây)/.test(syllable))     return ["A", "I"];
  if (/(ao|au|âu)/.test(syllable))     return ["A", "O"];

  // Đơn nguyên âm
  return [getVisemeForVietnameseSyllable(syllable)];
}

/**
 * Xác định viseme coda (âm cuối) của âm tiết.
 * Chỉ những âm cuối thay đổi hình miệng đáng kể.
 */
function getCodaViseme(syllable) {
  if (/[mp]$/.test(syllable)) return "M"; // đóng môi
  if (/[uo]$/.test(syllable)) return "U"; // tròn môi
  return null;
}
