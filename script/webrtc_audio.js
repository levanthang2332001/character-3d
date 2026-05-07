const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const state = {
  socket: null,
  peerConnection: null,
  localStream: null,
  remoteAudio: null,
  roomInput: null,
  joinButton: null,
  hangupButton: null,
  muteButton: null,
  status: null,
  isMuted: false,
};

export function initAudioCall() {
  state.remoteAudio = document.getElementById("remote-audio");
  state.roomInput = document.getElementById("call-room");
  state.joinButton = document.getElementById("call-join");
  state.hangupButton = document.getElementById("call-hangup");
  state.muteButton = document.getElementById("call-mute");
  state.status = document.getElementById("call-status");

  state.joinButton?.addEventListener("click", joinAudioRoom);
  state.hangupButton?.addEventListener("click", hangUp);
  state.muteButton?.addEventListener("click", toggleMute);

  updateCallStatus("Voice idle.");
}

async function joinAudioRoom() {
  const roomId = state.roomInput?.value?.trim();
  if (!roomId) {
    updateCallStatus("Enter a room id.");
    return;
  }

  try {
    setCallControls({ joining: true });
    updateCallStatus("Opening microphone...");

    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    createPeerConnection();
    for (const track of state.localStream.getAudioTracks()) {
      state.peerConnection.addTrack(track, state.localStream);
    }

    connectSignaling(roomId);
  } catch (error) {
    console.error(error);
    updateCallStatus("Cannot open microphone.");
    hangUp({ notifyPeer: false });
  }
}

function connectSignaling(roomId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.socket = new WebSocket(`${protocol}//${window.location.host}`);

  state.socket.addEventListener("open", () => {
    sendSignal({ type: "join", roomId });
    updateCallStatus(`Joining room ${roomId}...`);
  });

  state.socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    await handleSignal(message);
  });

  state.socket.addEventListener("close", () => {
    if (state.peerConnection) updateCallStatus("Signaling disconnected.");
  });
}

function createPeerConnection() {
  state.peerConnection = new RTCPeerConnection(RTC_CONFIG);

  state.peerConnection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      sendSignal({ type: "ice", candidate: event.candidate });
    }
  });

  state.peerConnection.addEventListener("track", (event) => {
    if (state.remoteAudio) {
      state.remoteAudio.srcObject = event.streams[0];
      state.remoteAudio.play().catch(() => {});
    }
    updateCallStatus("Connected. Remote audio active.");
  });

  state.peerConnection.addEventListener("connectionstatechange", () => {
    const status = state.peerConnection.connectionState;
    if (status === "connected") updateCallStatus("Connected.");
    if (["failed", "closed", "disconnected"].includes(status)) updateCallStatus(`Call ${status}.`);
  });
}

async function handleSignal(message) {
  switch (message.type) {
    case "joined":
      setCallControls({ joined: true });
      updateCallStatus(message.shouldCreateOffer ? "Peer found. Calling..." : "Waiting for peer...");
      if (message.shouldCreateOffer) await createAndSendOffer();
      break;
    case "peer-joined":
      updateCallStatus("Peer joined.");
      break;
    case "offer":
      await state.peerConnection.setRemoteDescription(message.description);
      await createAndSendAnswer();
      break;
    case "answer":
      await state.peerConnection.setRemoteDescription(message.description);
      break;
    case "ice":
      if (message.candidate) {
        await state.peerConnection.addIceCandidate(message.candidate);
      }
      break;
    case "peer-left":
      updateCallStatus("Peer left.");
      closePeerOnly();
      break;
    case "error":
      updateCallStatus(message.message || "Signaling error.");
      hangUp({ notifyPeer: false });
      break;
    default:
      break;
  }
}

async function createAndSendOffer() {
  const offer = await state.peerConnection.createOffer();
  await state.peerConnection.setLocalDescription(offer);
  sendSignal({ type: "offer", description: state.peerConnection.localDescription });
}

async function createAndSendAnswer() {
  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);
  sendSignal({ type: "answer", description: state.peerConnection.localDescription });
}

function toggleMute() {
  if (!state.localStream) return;

  state.isMuted = !state.isMuted;
  for (const track of state.localStream.getAudioTracks()) {
    track.enabled = !state.isMuted;
  }

  if (state.muteButton) state.muteButton.textContent = state.isMuted ? "Unmute" : "Mute";
  updateCallStatus(state.isMuted ? "Microphone muted." : "Microphone active.");
}

function hangUp(options = {}) {
  const { notifyPeer = true } = options;
  if (notifyPeer) sendSignal({ type: "leave" });

  closePeerOnly();

  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }

  state.isMuted = false;
  if (state.muteButton) state.muteButton.textContent = "Mute";
  setCallControls({ joined: false });
  updateCallStatus("Voice idle.");
}

function closePeerOnly() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  if (state.remoteAudio) {
    state.remoteAudio.srcObject = null;
  }
}

function sendSignal(message) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
  }
}

function setCallControls({ joining = false, joined = false }) {
  if (state.joinButton) state.joinButton.disabled = joining || joined;
  if (state.hangupButton) state.hangupButton.disabled = !joined && !joining;
  if (state.muteButton) state.muteButton.disabled = !joined && !joining;
}

function updateCallStatus(text) {
  if (state.status) state.status.textContent = text;
}
