const form = document.getElementById("askForm");
const input = document.getElementById("questionInput");
const messages = document.getElementById("messages");
const submitButton = document.getElementById("submitButton");
const statusBadge = document.getElementById("statusBadge");
const promptChips = document.querySelectorAll(".prompt-chip");

function appendMessage(role, text, extraClass = "") {
  const article = document.createElement("article");
  article.className = `message message-${role}${extraClass ? ` ${extraClass}` : ""}`;

  const roleEl = document.createElement("div");
  roleEl.className = "message-role";
  roleEl.textContent = role === "user" ? "You" : "Tara";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;

  article.appendChild(roleEl);
  article.appendChild(body);
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
}

function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  input.disabled = isLoading;
  statusBadge.textContent = isLoading ? "Thinking" : "Ready";
}

async function sendQuestion(question) {
  appendMessage("user", question);
  setLoadingState(true);

  try {
    const response = await fetch("/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    appendMessage("assistant", payload.answer || "No answer returned.");
  } catch (error) {
    appendMessage("assistant", error.message || "Unexpected error.", "message-error");
  } finally {
    setLoadingState(false);
    input.focus();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) {
    return;
  }

  input.value = "";
  await sendQuestion(question);
});

promptChips.forEach((chip) => {
  chip.addEventListener("click", async () => {
    const question = chip.dataset.question;
    if (!question) {
      return;
    }

    input.value = question;
    input.focus();
  });
});
