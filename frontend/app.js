const backendURL = "https://virtual-patient-realtime-production.up.railway.app";

let currentCase = null;
let mode = "text"; // text | voice

// UTC+4 timestamp helper
function muscatTimestamp() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Muscat" });
}

// Load case list
async function loadCases() {
  const res = await fetch("./cases.json");
  const cases = await res.json();
  const grid = document.getElementById("caseGrid");

  grid.innerHTML = "";
  cases.forEach(c => {
    const item = document.createElement("div");
    item.className = "card-item";
    item.innerHTML = `
      <img src="${c.avatar}" style="width:100%; border-radius:12px" />
      <h3>${c.name}</h3>
      <p>${c.title}</p>
    `;
    item.onclick = () => openCase(c);
    grid.appendChild(item);
  });
}

// Open case
function openCase(c) {
  currentCase = c;

  document.getElementById("caseView").classList.add("hidden");
  document.getElementById("chatView").classList.remove("hidden");
  document.getElementById("backToCases").classList.remove("hidden");

  document.getElementById("patientAvatar").src = c.avatar;
  document.getElementById("patientName").innerText = c.name;
  document.getElementById("patientCaseTitle").innerText = c.title;

  clearChat();
}

// Back button
document.getElementById("backToCases").onclick = () => {
  document.getElementById("chatView").classList.add("hidden");
  document.getElementById("caseView").classList.remove("hidden");
  document.getElementById("backToCases").classList.add("hidden");
};

// ---- CHAT UI ----
const chatBox = document.getElementById("chatBox");
function clearChat() { chatBox.innerHTML = ""; }

function addMessage(text, sender = "doctor") {
  const row = document.createElement("div");
  row.className = "bubble-row";

  const bubble = document.createElement("div");
  bubble.className = "bubble " + sender;
  bubble.textContent = text;

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = sender === "doctor" ? "./doctor.png" : "./patient.png";

  if (sender === "doctor") {
    row.appendChild(avatar);
    row.appendChild(bubble);
  } else {
    row.appendChild(bubble);
    row.appendChild(avatar);
  }

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ---- TEXT MODE ----
document.getElementById("btnTextMode").onclick = () => {
  mode = "text";
  document.getElementById("btnTextMode").classList.add("active");
  document.getElementById("btnVoiceMode").classList.remove("active");

  document.getElementById("textInputRow").classList.remove("hidden");
  document.getElementById("voiceRecordBtn").classList.add("hidden");

  document.getElementById("textInput").disabled = false;
  document.getElementById("sendTextBtn").disabled = false;
};

document.getElementById("sendTextBtn").onclick = async () => {
  const msg = document.getElementById("textInput").value.trim();
  if (!msg) return;

  addMessage(msg, "doctor");
  document.getElementById("textInput").value = "";

  const response = await fetch(`${backendURL}/chat_text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: msg,
      case_name: currentCase.name,
      language: document.getElementById("languageSelect").value
    })
  });

  const data = await response.json();
  addMessage(data.reply, "patient");
};

// ---- VOICE MODE ----
document.getElementById("btnVoiceMode").onclick = () => {
  mode = "voice";
  document.getElementById("btnVoiceMode").classList.add("active");
  document.getElementById("btnTextMode").classList.remove("active");

  document.getElementById("textInputRow").classList.add("hidden");
  document.getElementById("voiceRecordBtn").classList.remove("hidden");
};

let mediaRecorder;
let audioChunks = [];

const voiceBtn = document.getElementById("voiceRecordBtn");

voiceBtn.onmousedown = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);

  audioChunks = [];
  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

  mediaRecorder.onstop = sendVoiceToBackend;
  mediaRecorder.start();
};

voiceBtn.onmouseup = () => {
  mediaRecorder.stop();
};

// Send audio to backend
async function sendVoiceToBackend() {
  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const form = new FormData();
  form.append("file", blob, "voice.webm");

  addMessage("🎤 (Voice Sent)", "doctor");

  const res = await fetch(`${backendURL}/chat_voice`, {
    method: "POST",
    body: form
  });

  const data = await res.json();
  addMessage(data.reply, "patient");
}

// Load cases on start
loadCases();
