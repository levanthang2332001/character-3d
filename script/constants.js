/**
 * constants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tất cả dữ liệu tĩnh của dự án: không có logic, không có side effects.
 * Import từ bất kỳ module nào cần các giá trị cố định này.
 *
 * Nội dung:
 *  - EMOTIONS            : danh sách tên cảm xúc hỗ trợ
 *  - LIP_SYNC_MORPH_TARGETS: các morph target thuộc vùng miệng
 *  - lipSyncPresets      : hình miệng chuẩn cho từng viseme (A, E, I, O, U, M, AW)
 *  - emotionPresets      : morph preset cho từng cảm xúc
 *  - mouthCycle          : chuỗi viseme demo ngẫu nhiên
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Danh sách cảm xúc ───────────────────────────────────────────────────────

/**
 * Các cảm xúc được hỗ trợ, theo thứ tự sẽ chạy khi ở chế độ "Random Auto".
 * Thêm cảm xúc mới: thêm vào đây + thêm preset tương ứng trong emotionPresets.
 */
export const EMOTIONS = ["smile", "angry", "sad", "surprise", "disgust", "fear"];

// ─── Lip Sync Morph Targets ───────────────────────────────────────────────────

/**
 * Danh sách morph target thuộc vùng miệng/hàm.
 * Khi lip sync đang chạy, face_mesh.js sẽ KHÔNG ghi đè các target này
 * (để lip sync controller tự quản lý).
 *
 * Tương ứng với các muscle group trên mặt người:
 *  - jawOpen:         hàm mở
 *  - mouthFunnel:     môi tròn như thổi sáo
 *  - mouthPucker:     môi chu như hôn
 *  - mouthSmile_L/R:  khóe miệng kéo lên (cười)
 *  - mouthPress_L/R:  môi ép chặt vào nhau (âm M/B/P)
 *  - mouthStretch_L/R: kéo miệng rộng ngang (âm E/I)
 *  - mouthUpperUp_L/R: môi trên kéo lên
 *  - mouthLowerDown_L/R: môi dưới kéo xuống
 *  - mouthRollLower:  môi dưới cuộn vào
 *  - mouthRollUpper:  môi trên cuộn vào
 */
export const LIP_SYNC_MORPH_TARGETS = [
  "jawOpen",
  "mouthFunnel",
  "mouthPucker",
  "mouthSmile_L",
  "mouthSmile_R",
  "mouthPress_L",
  "mouthPress_R",
  "mouthStretch_L",
  "mouthStretch_R",
  "mouthUpperUp_L",
  "mouthUpperUp_R",
  "mouthLowerDown_L",
  "mouthLowerDown_R",
  "mouthRollLower",
  "mouthRollUpper",
];

// ─── Lip Sync Viseme Presets ──────────────────────────────────────────────────

/**
 * Hình miệng chuẩn cho từng viseme (đơn vị hình miệng tương ứng âm thanh).
 * Mỗi preset là một object { morphTargetName: value [0-1] }.
 * Morph không được liệt kê → mặc định 0.
 *
 * Viseme mapping với âm tiếng Việt:
 *  rest → im lặng / kết thúc câu
 *  A    → a, ă, â (miệng mở rộng)
 *  AW   → oa, oă, oe (miệng tròn + mở)
 *  E    → e, ê (miệng kéo ngang)
 *  I    → i, y (miệng kéo ngang hẹp)
 *  O    → o, ô, ơ (miệng tròn vừa)
 *  U    → u, ư (miệng tròn hẹp)
 *  M    → m, b, p (môi khép)
 */
export const lipSyncPresets = {
  rest: {
    jawOpen:      0.02,
    mouthPress_L: 0.08,
    mouthPress_R: 0.08,
  },
  A: {
    jawOpen:          0.82,   // hàm mở rộng nhất
    mouthLowerDown_L: 0.18,
    mouthLowerDown_R: 0.18,
  },
  AW: {
    jawOpen:       0.56,
    mouthFunnel:   0.32,  // môi tròn
    mouthRollLower: 0.12,
    mouthRollUpper: 0.12,
  },
  E: {
    jawOpen:       0.22,
    mouthSmile_L:  0.32,  // kéo ngang
    mouthSmile_R:  0.32,
    mouthStretch_L: 0.28,
    mouthStretch_R: 0.28,
  },
  I: {
    jawOpen:       0.18,
    mouthStretch_L: 0.44, // kéo ngang nhiều hơn E
    mouthStretch_R: 0.44,
    mouthSmile_L:  0.18,
    mouthSmile_R:  0.18,
  },
  O: {
    jawOpen:     0.44,
    mouthFunnel: 0.48,  // môi tròn vừa
    mouthPucker: 0.18,
  },
  U: {
    jawOpen:     0.18,
    mouthPucker: 0.7,   // môi chu nhiều nhất
    mouthFunnel: 0.18,
  },
  M: {
    jawOpen:       0.04,    // hàm gần đóng
    mouthPress_L:  0.58,    // môi ép chặt
    mouthPress_R:  0.58,
    mouthRollLower: 0.22,
    mouthRollUpper: 0.18,
  },
};

// ─── Emotion Presets ──────────────────────────────────────────────────────────

/**
 * Preset morph target cho từng cảm xúc.
 * Được áp qua setEmotion() trong facecap.js.
 *
 * Lưu ý tên morph target dùng hệ tọa độ của MODEL (không phải MediaPipe):
 *  _L = trái của model (= phải trong camera selfie)
 *  _R = phải của model (= trái trong camera selfie)
 */
export const emotionPresets = {
  neutral: {
    // Tất cả về 0 (gọi resetAll() trước khi áp preset)
  },
  smile: {
    browInnerUp:  0.3,   // lông mày nhíu nhẹ
    mouthSmile_L: 1,     // miệng cười to
    mouthSmile_R: 1,
    cheekPuff_L:  0.3,   // má phồng (vui)
    cheekPuff_R:  0.3,
  },
  angry: {
    browDown_L:   0.8,   // lông mày cau xuống
    browDown_R:   0.8,
    eyeSquint_L:  0.5,   // mắt nheo
    eyeSquint_R:  0.5,
    mouthFunnel:  0.4,   // miệng mím
  },
  sad: {
    browInnerUp:  0.6,   // lông mày trong cong lên (buồn)
    mouthFrown_L: 0.7,   // khóe miệng xuống
    mouthFrown_R: 0.7,
  },
  surprise: {
    browOuterUp_L:  1,     // lông mày ngoài kéo lên cao
    browOuterUp_R:  1,
    eyeWideOpen_L:  0.8,   // mắt mở to
    eyeWideOpen_R:  0.8,
    jawOpen:        0.6,   // miệng hé mở
  },
  disgust: {
    noseSneer_L:    0.7,   // mũi nhăn
    noseSneer_R:    0.7,
    mouthUpperUp_L: 0.5,   // môi trên kéo lên (nhăn miệng)
    mouthLowerDown_L: 0.3,
  },
  fear: {
    browOuterUp_L: 0.7,   // lông mày lo lắng
    browOuterUp_R: 0.7,
    eyeWideOpen_L: 0.6,   // mắt mở to nhưng không bằng surprise
    eyeWideOpen_R: 0.6,
    jawOpen:       0.3,   // miệng mở nhẹ
    mouthFunnel:   0.4,
  },
};

// ─── Demo Data ────────────────────────────────────────────────────────────────

/**
 * Chuỗi viseme cho demo animation miệng.
 * Đại diện cho một câu nói ngắn với đầy đủ các hình miệng.
 */
export const mouthCycle = ["A", "E", "O", "A", "U", "A", "E", "O", "U", "A", "M", "E", "O", "A"];
