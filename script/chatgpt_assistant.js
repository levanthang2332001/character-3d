import { setEmotion, startSpeechFromText, isLipSyncActive } from "./facecap.js";

const API_ENDPOINT = "/api/chat";

const state = {
  recognition: null,
  isListening: false,
  chatHistory: [],
  panelOpen: true,
  autoListen: false,
};

export function initChatGPTAssistant() {
  initSpeechRecognition();
  setupUI();
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus("STT not supported");
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.lang = "vi-VN";

  state.recognition.onstart = () => {
    state.isListening = true;
    updateMicButton("listening");
  };

  state.recognition.onend = () => {
    state.isListening = false;
    updateMicButton(state.autoListen ? "auto" : false);
  };

  state.recognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimTranscript) updateInterimText(interimTranscript);
    if (finalTranscript) {
      const text = finalTranscript.trim();
      if (text) handleUserInput(text);
    }
  };

  state.recognition.onerror = (event) => {
    console.error("STT error:", event.error);
    updateStatus(`STT Error: ${event.error}`);
    if (event.error === "no-speech" || event.error === "audio-capture") {
      restartRecognition();
    }
  };
}

function setupUI() {
  const toggleBtn = document.getElementById("ai-toggle-btn");
  toggleBtn?.addEventListener("click", () => {
    state.panelOpen = !state.panelOpen;
    const panel = document.getElementById("ai-panel");
    const chatMessages = document.getElementById("chat-messages");
    if (panel) panel.style.display = state.panelOpen ? "block" : "none";
    if (chatMessages) chatMessages.style.display = state.panelOpen ? "block" : "none";
    if (toggleBtn) {
      toggleBtn.textContent = state.panelOpen ? "▼ AI Assistant" : "▶ AI Assistant";
    }
  });

  const micBtn = document.getElementById("ai-mic-btn");
  micBtn?.addEventListener("click", () => {
    state.autoListen = !state.autoListen;
    updateMicButton(state.autoListen ? "auto" : false);
    if (state.autoListen) {
      updateStatus("Auto mode ON");
      startListening();
    } else {
      stopListening();
      updateStatus("Auto mode OFF");
    }
  });

  const sendBtn = document.getElementById("ai-send-btn");
  const textInput = document.getElementById("ai-text-input");
  sendBtn?.addEventListener("click", () => {
    const text = textInput?.value?.trim();
    if (text) {
      handleUserInput(text);
      if (textInput) textInput.value = "";
    }
  });

  textInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = textInput.value?.trim();
      if (text) {
        handleUserInput(text);
        textInput.value = "";
      }
    }
  });

  updateStatus("Ready");
}

export function startListening() {
  if (!state.recognition) {
    updateStatus("STT not initialized");
    return;
  }
  if (state.isListening) return;

  try {
    state.recognition.start();
    updateStatus("Listening...");
  } catch (e) {
    if (e.name === "InvalidStateError") {
      state.recognition.stop();
      setTimeout(() => state.recognition?.start(), 100);
    }
  }
}

export function stopListening() {
  if (!state.recognition || !state.isListening) return;
  state.recognition.stop();
}

function restartRecognition() {
  if (state.isListening) return;
  setTimeout(() => {
    if (!state.isListening) {
      try {
        state.recognition?.start();
      } catch (e) {
        console.error("Restart failed:", e);
      }
    }
  }, 500);
}

async function handleUserInput(text) {
  if (!text?.trim()) return;
  if (isLipSyncActive()) return;

  addToChat("user", text);
  stopListening();
  updateStatus("Thinking...");

  try {
    const response = await callOpenAIStream(text);
    analyzeAndSetEmotion(text, response);

    const speakInput = document.getElementById("speak-input");
    if (speakInput) {
      speakInput.value = response;
      startSpeechFromText();
    }

    updateStatus("Speaking...");

    waitForLipSyncDone().then(() => {
      updateStatus(state.autoListen ? "Auto mode ON" : "Ready");
      if (state.autoListen) startListening();
    });

  } catch (error) {
    console.error("Error:", error);
    addToChat("assistant", `Lỗi: ${error.message}`);
    updateStatus("Error");
    if (state.autoListen) setTimeout(() => startListening(), 1000);
  }
}

function waitForLipSyncDone() {
  return new Promise((resolve) => {
    const check = () => {
      if (!isLipSyncActive()) return resolve();
      setTimeout(check, 500);
    };
    setTimeout(resolve, 15000);
    check();
  });
}

async function callOpenAIStream(userMessage) {
  state.chatHistory.push({ role: "user", content: userMessage });

  const messages = [
    { role: "system", content: "Bạn là trợ lý ảo thân thiện tên HoloLab. Trả lời ngắn gọn 2-3 câu. Nói tiếng Việt." },
    ...state.chatHistory
  ];

  if (state.chatHistory.length > 8) {
    state.chatHistory = state.chatHistory.slice(-8);
  }

  const msgElement = addToChat("assistant", "...");
  let fullResponse = "";

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true })
  });

  if (!response.ok) {
    let errorText;
    try {
      const data = await response.clone().json();
      errorText = data.error || `API error: ${response.status}`;
    } catch {
      const text = await response.clone().text();
      errorText = text.includes("404") ? "API endpoint không tồn tại" : `API error: ${response.status}`;
    }
    throw new Error(errorText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const token = JSON.parse(data).choices?.[0]?.delta?.content;
        if (token) {
          fullResponse += token;
          msgElement.textContent = `🤖 ${fullResponse}`;
        }
      } catch (e) {}
    }
  }

  if (!fullResponse) throw new Error("Không nhận được phản hồi từ AI");

  state.chatHistory.push({ role: "assistant", content: fullResponse });
  return fullResponse;
}

function analyzeAndSetEmotion(text, response) {
  const lower = (text + " " + response).toLowerCase();
  const emotionMap = [
    { keys: ["vui", "happy", "tuyệt"], emotion: "smile" },
    { keys: ["buồn", "sad"], emotion: "sad" },
    { keys: ["tức", "giận"], emotion: "angry" },
    { keys: ["ngạc nhiên", "surprise", "wow"], emotion: "surprise" },
    { keys: ["ghê", "disgust"], emotion: "disgust" },
    { keys: ["sợ", "fear"], emotion: "fear" },
  ];

  for (const { keys, emotion } of emotionMap) {
    if (keys.some(k => lower.includes(k))) {
      setEmotion(emotion);
      return;
    }
  }
  setEmotion("neutral");
}

function addToChat(role, content) {
  const container = document.getElementById("chat-messages");
  if (!container) return null;

  const msg = document.createElement("div");
  msg.style.cssText = "padding: 8px; margin: 4px 0; border-radius: 8px; max-width: 90%; word-wrap: break-word;";

  if (role === "user") {
    msg.style.background = "#2196F3";
    msg.style.color = "white";
    msg.style.marginLeft = "auto";
    msg.textContent = `👤 ${content}`;
  } else {
    msg.style.background = "#4CAF50";
    msg.style.color = "white";
    msg.textContent = `🤖 ${content}`;
  }

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

function updateInterimText(text) {
  let interim = document.getElementById("chat-interim");
  if (!interim) {
    const container = document.getElementById("chat-messages");
    if (container) {
      interim = document.createElement("div");
      interim.id = "chat-interim";
      interim.style.cssText = "color: #888; font-style: italic; padding: 4px; font-size: 12px;";
      container.insertBefore(interim, container.firstChild);
    }
  }
  if (interim) interim.textContent = `🎤 ${text}...`;
}

function updateMicButton(mode) {
  const micBtn = document.getElementById("ai-mic-btn");
  if (!micBtn) return;

  const modes = {
    auto: { text: "⏹️ Auto", bg: "#f44336" },
    listening: { text: "🔴 Listening", bg: "#ff9800" },
  };

  const { text, bg } = modes[mode] || { text: "🎤 Mic", bg: "#4CAF50" };
  micBtn.textContent = text;
  micBtn.style.background = bg;

  const status = document.getElementById("ai-status");
  if (status) {
    status.textContent = mode === "auto" ? "Auto mode ON" : mode === "listening" ? "Listening..." : "Ready";
    status.style.color = mode === "listening" ? "#ff0" : "#0f0";
  }
}

function updateStatus(text) {
  const status = document.getElementById("ai-status");
  if (status) status.textContent = text;
}
