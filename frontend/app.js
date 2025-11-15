// Final app.js with text + voice modes

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
const voiceRecordBtn = $("#voiceRecordBtn");

let selectedCase = null;
let selectedAvatar = null;
let mode = "text";
let history = [];

const DOCTOR_ICON = "👨‍⚕️";

// Map case id -> avatar file
const avatarMap = {
  "001_ear_pain": "Ear_pain_sarah_female.png",
  "002_neck_lump": "neck_lump_Ahmed_male.png",
  "003_blocked_nose": "blocked_nose_Wisam_female.png",
  "004_red_eye": "red_eye_Mariam_female.png",
  "005_blurred_vision": "blurred_vision_Salem_male.png",
  "006_sudden_blurred_vision": "sudden_blurred_vision_Salma_female.png",
  "007_watery_eye": "watery_eye_Aisha_female.png",
  "008_double_vision": "double_vision_Nasser_male.png",
};

function addBubble(role, text, audioB64 = null) {
  const row = document.createElement("div");
  row.className =
    "bubble-row " + (role === "user" ? "doctor-row" : "patient-row");

  const avatar = document.createElement("div");
  avatar.className = "avatar";

  if (role === "user") {
    avatar.textContent = DOCTOR_ICON;
    avatar.style.fontSize = "24px";
  } else {
    const img = document.createElement("img");
    img.src = "./avatars/" + selectedAvatar;
    avatar.appendChild(img);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble " + (role === "user" ? "doctor" : "patient");
  bubble.textContent = text;

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

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error("Request failed");
  return await r.json();
}

// Load cases from backend
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

function openChatPage() {
  $("#bigAvatar").src = "./avatars/" + selectedAvatar;
  $("#patientName").textContent = selectedCase.title.split("–")[0];
  $("#caseTitle").textContent = selectedCase.title;

  chatBox.innerHTML = "";
  history = [];
  mode = "text";
  setMode("text");

  caseSelectView.classList.add("hidden");
  chatView.classList.remove("hidden");
  globalBackBtn.classList.remove("hidden");

  userInput.disabled = false;
  sendBtn.disabled = false;

  const greeting = "Hello doctor, I am your patient for this case.";
  addBubble("assistant", greeting);
  history.push({ role: "assistant", content: greeting });
}

// -------- TEXT MODE --------
sendBtn.onclick = async () => {
  const msg = userInput.value.trim();
  if (!msg || !selectedCase) return;

  userInput.value = "";
  addBubble("user", msg);
  history.push({ role: "user", content: msg });

  const payload = {
    case_id: selectedCase.id,
    language: $("#language").value,
    gender: "male",
    history,
  };

  const res = await fetchJSON("/api/text_reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  history.push({ role: "assistant", content: res.reply });
  addBubble("assistant", res.reply, res.audio_b64);
};

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

// -------- MODE TOGGLE --------
modeTextBtn.onclick = () => setMode("text");
modeVoiceBtn.onclick = () => setMode("voice");

function setMode(m) {
  mode = m;
  const isText = m === "text";

  $("#inputRow").classList.toggle("hidden", !isText);
  voiceRecordBtn.classList.toggle("hidden", isText);

  modeTextBtn.classList.toggle("active", isText);
  modeVoiceBtn.classList.toggle("active", !isText);
}

// -------- BACK TO CASES --------
globalBackBtn.onclick = () => {
  chatView.classList.add("hidden");
  caseSelectView.classList.remove("hidden");
  globalBackBtn.classList.add("hidden");
  chatBox.innerHTML = "";
  userInput.value = "";
  userInput.disabled = true;
  sendBtn.disabled = true;
  selectedCase = null;
  selectedAvatar = null;
  history = [];
};

// -------- END ENCOUNTER (Transcript download) --------
endEncounterBtn.onclick = () => {
  const lines = history.map((h) => {
    const speaker = h.role === "user" ? "Doctor" : "Patient";
    return `${speaker}: ${h.content}`;
  });
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
  const a = document.createElement("a");
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:T]/g, "-").split(".")[0];
  a.href = URL.createObjectURL(blob);
  a.download = `encounter_${timestamp}.txt`;
  a.click();
  globalBackBtn.click();
};

// -------- VOICE MODE: Push-to-Talk --------
let mediaRecorder = null;
let audioChunks = [];

async function startRecording() {
  if (!selectedCase) return;
  audioChunks = [];

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      await sendVoiceBlob(blob);
      stream.getTracks().forEach((t) => t.stop());
    };

    mediaRecorder.start();
    voiceRecordBtn.textContent = "🛑 Release to Stop";
    voiceRecordBtn.style.backgroundColor = "#b32020";
  } catch (err) {
    console.error("Mic error", err);
    alert("Microphone access denied or unavailable.");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  voiceRecordBtn.textContent = "🎤 Hold to Talk";
  voiceRecordBtn.style.backgroundColor = "#4B2E83";
}

voiceRecordBtn.addEventListener("mousedown", startRecording);
voiceRecordBtn.addEventListener("mouseup", stopRecording);
voiceRecordBtn.addEventListener("mouseleave", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
});
voiceRecordBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startRecording();
});
voiceRecordBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  stopRecording();
});

async function sendVoiceBlob(blob) {
  if (!selectedCase) return;

  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  form.append("case_id", selectedCase.id);
  form.append("language", $("#language").value);
  form.append("gender", "male");
  form.append("history", JSON.stringify(history));

  const res = await fetch("/api/voice_reply", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    console.error("Voice reply failed");
    return;
  }

  const data = await res.json();

  // Show the transcribed doctor question as a bubble
  if (data.transcript) {
    addBubble("user", data.transcript);
    history.push({ role: "user", content: data.transcript });
  }

  // Show patient reply
  if (data.reply) {
    addBubble("assistant", data.reply, data.audio_b64);
    history.push({ role: "assistant", content: data.reply });
  }
}
