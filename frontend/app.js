// ======================================================
// FINAL BILINGUAL SPEECH RECOGNITION (AR + EN)
// ======================================================

const $ = (q) => document.querySelector(q);
const caseSelectView = $("#caseSelectView");
const chatView = $("#chatView");
const globalBackBtn = $("#globalBackBtn");
const endEncounterBtn = $("#endEncounterBtn");
const chatBox = $("#chatBox");
const userInput = $("#userInput");
const sendBtn = $("#sendBtn");
const modeTextBtn = $("#modeText");
const modeVoiceBtn = $("#modeVoice");
const micBtn = $("#micBtn");

let selectedCase = null;
let selectedAvatar = null;
let mode = "text";
let history = [];
let recognition = null;
let isRecording = false;
let currentLang = "en-US";   // default

// Avatar map unchanged
const avatarMap = {
  "001_ear_pain": "Ear_pain_sarah_female.png",
  "002_neck_lump": "neck_lump_Ahmed_male.png",
  "003_blocked_nose": "blocked_nose_Wisam_female.png",
  "004_red_eye": "red_eye_Mariam_female.png",
  "005_blurred_vision": "blurred_vision_Salem_male.png",
  "006_sudden_blurred_vision": "sudden_blurred_vision_Salma_female.png",
  "007_watery_eye": "watery_eye_Aisha_female.png",
  "008_double_vision": "double_vision_Nasser_male.png"
};

// ======================================================
// 1) Strong Language Detector
// ======================================================
function detectLanguageStrong(text) {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasEnglish = /[A-Za-z]/.test(text);

  if (hasArabic && !hasEnglish) return "ar-SA";
  if (hasEnglish && !hasArabic) return "en-US";

  // Mixed? pick based on majority
  const arCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const enCount = (text.match(/[A-Za-z]/g) || []).length;

  if (arCount > enCount) return "ar-SA";
  if (enCount > arCount) return "en-US";

  // fallback → UI selected language
  return $("#language").value === "Arabic" ? "ar-SA" : "en-US";
}

// ======================================================
// Add bubble function
// ======================================================
function addBubble(role, text, audioB64 = null) {
  const row = document.createElement("div");
  row.className = "bubble-row " + (role === "user" ? "doctor-row" : "patient-row");

  const avatar = document.createElement("div");
  avatar.className = "avatar";

  if (role === "user") {
    avatar.textContent = "Dr";
    avatar.style.background = "#4B2E83";
    avatar.style.color = "white";
    avatar.style.display = "flex";
    avatar.style.alignItems = "center";
    avatar.style.justifyContent = "center";
  } else {
    const img = document.createElement("img");
    img.src = "./avatars/" + selectedAvatar;
    avatar.appendChild(img);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble " + (role === "user" ? "doctor" : "patient");
  bubble.innerHTML = text;

  if (audioB64) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.src = `data:audio/mp3;base64,${audioB64}`;
    bubble.appendChild(audio);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ======================================================
// Send message
// ======================================================
async function sendMessage(msg) {
  userInput.value = "";
  addBubble("user", msg);
  history.push({ role: "user", content: msg });

  const payload = {
    case_id: selectedCase.id,
    language: $("#language").value,
    gender: "male",
    history
  };

  const res = await fetchJSON("/api/text_reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  history.push({ role: "assistant", content: res.reply });
  addBubble("assistant", res.reply, res.audio_b64);
}

// ======================================================
// 2) HARD restart SpeechRecognition to switch language
// ======================================================
function restartRecognition(newLang) {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = newLang;
  recognition.interimResults = true;
  recognition.continuous = false;
  currentLang = newLang;
}

// ======================================================
// Voice Recording
// ======================================================
function startSpeech() {
  restartRecognition(currentLang);

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    userInput.placeholder = "Listening…";
  };

  recognition.onresult = (e) => {
    let transcript = "";
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }

    userInput.value = transcript;

    // Detect language dynamically
    const detected = detectLanguageStrong(transcript);

    if (detected !== currentLang) {
      restartRecognition(detected);
      setTimeout(() => recognition.start(), 150);
    }
  };

  recognition.onend = () => {
    stopSpeech();
    const finalText = userInput.value.trim();
    if (finalText) sendMessage(finalText);
  };

  recognition.start();
}

function stopSpeech() {
  isRecording = false;
  micBtn.classList.remove("recording");
  micBtn.textContent = "🎤";
  userInput.placeholder = "Type your message…";
}

// mic click
micBtn.onclick = () => {
  if (!isRecording) startSpeech();
  else recognition.stop();
};

// ======================================================
// Mode toggle
// ======================================================
modeTextBtn.onclick = () => {
  mode = "text";
  micBtn.classList.add("hidden");
  modeTextBtn.classList.add("active");
  modeVoiceBtn.classList.remove("active");
};

modeVoiceBtn.onclick = () => {
  mode = "voice";
  micBtn.classList.remove("hidden");
  modeVoiceBtn.classList.add("active");
  modeTextBtn.classList.remove("active");
};

// ======================================================
// Helpers + Back + End Encounter (unchanged)
// ======================================================
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  return await r.json();
}

globalBackBtn.onclick = () => location.reload();

endEncounterBtn.onclick = () => {
  const lines = history.map(h =>
    `${h.role === "user" ? "Doctor" : "Patient"}: ${h.content}`
  );

  const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
  const a = document.createElement("a");
  const now = new Date();
  const muscatOffset = 4 * 60;
  const local = new Date(now.getTime() + muscatOffset * 60000);
  const timestamp = local.toISOString().replace(/[:T]/g, "-").split(".")[0];

  a.href = URL.createObjectURL(blob);
  a.download = `encounter_${timestamp}.txt`;
  a.click();
};
