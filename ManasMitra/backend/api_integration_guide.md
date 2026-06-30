# API Integration Guide

This guide details how to consume the pre-screening chatbot endpoints in third-party applications.

## API Architecture

The pre-screening service exposes the following endpoints:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **POST** | `/api/threads` | Create a new pre-screening session. |
| **POST** | `/api/threads/{thread_id}/chat` | Send a chat message and receive the pre-screening response (JSON). |
| **POST** | `/api/threads/{thread_id}/report` | Generate the detailed clinical pre-screening report. |
| **GET** | `/api/metrics` | Retrieve pre-screening LLM evaluation metrics. |

---

## Integration Examples

### 1. Creating a Thread Session

**cURL Request**:
```bash
curl -X POST http://localhost:8000/api/threads \
     -H "Content-Type: application/json" \
     -d '{"title": "New Session"}'
```

**JavaScript Fetch**:
```javascript
const response = await fetch('http://localhost:8000/api/threads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'New Session' })
});
const thread = await response.json();
console.log('Session ID:', thread.id);
```

---

### 2. Sending Chat Messages

Send the user's message to the chatbot. If the backend environment variable `GROQ_API_KEY` is not set, you must pass the API key in the `X-API-Key` header.

**Python Requests**:
```python
import requests

url = "http://localhost:8000/api/threads/YOUR_THREAD_ID/chat"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "gsk_..."  # Optional if set on backend
}
data = {
    "content": "I feel some stiffness in my left arm and tremors at rest."
}

res = requests.post(url, headers=headers, json=data)
print(res.json())
```

**Response JSON**:
```json
{
  "role": "assistant",
  "content": "I understand that you're noticing tremors and arm stiffness.\n\nTo help evaluate these symptoms, please complete the recommended motor activity below.",
  "suggested_test": "motor",
  "complete": false
}
```

---

### 3. Submitting Test Results

When a user completes an interactive test (like spiral drawing or digit recall), post the structured result string prefixed with `SYSTEM: User completed the [Test Name] test. Results: ...` to feed the metrics to the clinical LLM history.

**JavaScript Fetch**:
```javascript
const systemMsg = "SYSTEM: User completed the Motor (Spiral Tracing) test. Results: Stability Index = 85%, Average Path Deviation = 4px, Tremor Classification = Low (Normal).";

await fetch('http://localhost:8000/api/threads/YOUR_THREAD_ID/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: systemMsg })
});
```

---

### 4. Compiling the Verification Report

Once `complete` is returned as `true` in the chat endpoint, call the report generation endpoint to get the final verification report in beautified Markdown format.

**cURL Request**:
```bash
curl -X POST http://localhost:8000/api/threads/YOUR_THREAD_ID/report \
     -H "X-API-Key": "gsk_..."
```
