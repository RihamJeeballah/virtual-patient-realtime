// ============================
// Final app.js – Auto Arabic/English Voice Recognition
// ============================

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

// Avatar Map unchanged
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

// ========================================================
// Language Detection Function
// ========================================================

function detectLanguage(text) {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  if (hasArabic) return "ar-SA";
  return "en-US";
}

// ========================================================
// Add Bubble
// ========================================================
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
    audio.src = `data:audio/mp3;base64,${audio_b64}`;
    bubble.appendChild(audio);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ========================================================
// Fetch JSON
// ========================================================
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  return await r.json();
}

// ========================================================
// Load Cases
// ========================================================
async function loadCases() {
  const cards = $("#cards");
  cards.innerHTML = "";
  const cases = await fetchJSON("/api/cases");
  cases.forEach((c) => {
    const avatar = avatarMap[c.id] || "default.png";
    const div = document.createElement("div");
    div.className = "card-item";
    div.innerHTML = `<img src="./avatars/${avatar}" /><div class="card-title">${c.title}</div>`;
    div.onclick = () => {
      selectedCase = c;
      selectedAvatar = avatar;
      openChatPage();
    };
    cards.appendChild(div);
  });
}
loadCases();

// ========================================================
// Open Chat Page
// ========================================================
function openChatPage() {
  $("#bigAvatar").src = "./avatars/" + selectedAvatar;
  $("#patientName").textContent = selectedCase.title.split("–")[0];
  $("#caseTitle").textContent = selectedCase.title;

  chatBox.innerHTML = "";
  userInput.disabled = false;
  sendBtn.disabled = false;
  history = [];

  caseSelectView.classList.add("hidden");
  chatView.classList.remove("hidden");
  globalBackBtn.classList.remove("hidden");

  addBubble("assistant", "Hello doctor, I am your patient for this case.");
  history.push({ role: "assistant", content: "Hello doctor, I am your patient for this case." });
}

// ========================================================
// Send Text Message
// ========================================================
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

// ========================================================
// Voice Recognition with Auto-Language Switching
// ========================================================
function startSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("Your browser does not support speech recognition.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ar-SA"; // default Arabic
  recognition.interimResults = true;
  recognition.continuous = false;

  userInput.value = "";

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    userInput.placeholder = "Listening…";
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    userInput.value = transcript;

    // Language auto-detection
    const detected = detectLanguage(transcript);
    if (detected !== recognition.lang) {
      recognition.stop();
      setTimeout(() => {
        recognition.lang = detected;
        recognition.start();
      }, 150);
    }
  };

  recognition.onend = () => {
    stopRecording();
    const text = userInput.value.trim();
    if (text) sendMessage(text);
  };

  recognition.start();
}

function stopRecording() {
  isRecording = false;
  micBtn.classList.remove("recording");
  micBtn.textContent = "🎤";
  userInput.placeholder = "Type your message…";
}

micBtn.onclick = () => {
  if (!isRecording) startSpeechRecognition();
  else recognition.stop();
};

// ========================================================
// Mode Toggle
// ========================================================
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

// ========================================================
// Back
// ========================================================
globalBackBtn.onclick = () => {
  chatView.classList.add("hidden");
  caseSelectView.classList.remove("hidden");
  globalBackBtn.classList.add("hidden");
  chatBox.innerHTML = "";
  userInput.value = "";
  userInput.disabled = true;
  sendBtn.disabled = true;
  history = [];
  selectedCase = null;
  selectedAvatar = null;
};

// ========================================================
// End Encounter
// ========================================================
endEncounterBtn.onclick = () => {
  const lines = history.map((h) => {
    const speaker = h.role === "user" ? "Doctor" : "Patient";
    return `${speaker}: ${h.content}`;
  });

  const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
  const a = document.createElement("a");

  const now = new Date();
  const muscatOffset = 4 * 60;
  const local = new Date(now.getTime() + muscatOffset * 60000);
  const timestamp = local.toISOString().replace(/[:T]/g, "-").split(".")[0];

  a.href = URL.createObjectURL(blob);
  a.download = `encounter_${timestamp}.txt`;
  a.click();

  globalBackBtn.click();
};
