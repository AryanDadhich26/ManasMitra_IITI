import React, { useState, useEffect, useRef } from "react";
import "./App.css";


const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function App() {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [groqApiKey, setGroqApiKey] = useState(
    localStorage.getItem("groq_api_key") || ""
  );
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  
  // Interactive test and completion states
  const [suggestedTest, setSuggestedTest] = useState(null);
  const [activeTest, setActiveTest] = useState(null);
  const [isComplete, setIsComplete] = useState(false);
  
  // Theme state
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  
  // Report states
  const [report, setReport] = useState(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  // Speech synthesis and recognition states
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeakingTask, setIsSpeakingTask] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Apply Theme class
  useEffect(() => {
    localStorage.setItem("theme", theme);
    if (theme === "light") {
      document.documentElement.classList.add("light-mode");
    } else {
      document.documentElement.classList.remove("light-mode");
    }
  }, [theme]);

  // Sync API Key to Local Storage
  useEffect(() => {
    localStorage.setItem("groq_api_key", groqApiKey);
  }, [groqApiKey]);

  // Load Initial Threads and Documents
  useEffect(() => {
    fetchThreads();
    fetchDocuments();
  }, []);

  // Fetch Messages when active thread changes
  useEffect(() => {
    if (activeThreadId) {
      fetchMessages(activeThreadId);
      setReport(null); // Clear previous reports
      setSuggestedTest(null);
      setIsComplete(false);
    } else {
      setMessages([]);
    }
  }, [activeThreadId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const fetchThreads = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/threads`);
      if (response.ok) {
        const data = await response.json();
        setThreads(data);
        if (data.length > 0 && !activeThreadId) {
          setActiveThreadId(data[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching threads:", error);
    }
  };

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/documents`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
  };

  const fetchMessages = async (threadId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
        
        // Scan history to see if pre-screening was already completed
        const userTurns = data.filter(m => m.role === 'user' && !m.content.startsWith("SYSTEM:")).length;
        if (userTurns >= 12) {
          setIsComplete(true);
        }
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (response.ok) {
        const newThread = await response.json();
        setThreads([newThread, ...threads]);
        setActiveThreadId(newThread.id);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error starting new chat:", error);
    }
  };

  const deleteThread = async (threadId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this thread?")) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        const updatedThreads = threads.filter((t) => t.id !== threadId);
        setThreads(updatedThreads);
        if (activeThreadId === threadId) {
          setActiveThreadId(updatedThreads.length > 0 ? updatedThreads[0].id : null);
        }
      }
    } catch (error) {
      console.error("Error deleting thread:", error);
    }
  };

  const sendMessage = async (textToSend = inputText) => {
    const text = textToSend.trim();
    if (!text || !activeThreadId) return;


    // Append user message immediately
    const userMsg = { role: "user", content: text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE_URL}/threads/${activeThreadId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": groqApiKey,
        },
        body: JSON.stringify({ content: text }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Server error");
      }

      const botMsg = await response.json();
      setMessages((prev) => [...prev, botMsg]);
      
      // Update interactive test and completion states
      setSuggestedTest(botMsg.suggested_test || null);
      if (botMsg.complete) {
        setIsComplete(true);
      }
      
      // Refresh thread list to fetch auto-generated title if it was a New Chat
      const activeThread = threads.find(t => t.id === activeThreadId);
      if (activeThread && (activeThread.title === "New Chat" || activeThread.title === "New Session")) {
        fetchThreads();
      }
    } catch (error) {
      alert(`Chat error: ${error.message}`);
      // Remove last user message on failure to let user try again
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const generateReport = async () => {
    if (!activeThreadId) return;

    setIsGeneratingReport(true);
    setReport(null);

    try {
      const response = await fetch(`${API_BASE_URL}/threads/${activeThreadId}/report`, {
        method: "POST",
        headers: {
          "X-API-Key": groqApiKey,
        },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Could not generate report");
      }

      const data = await response.json();
      setReport(data.report);
    } catch (error) {
      alert(`Report Error: ${error.message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pre_screening_report_${activeThreadId.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const printReport = () => {
    window.print();
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleSpeakToggle = (text, idx) => {
    if (window.speechSynthesis.speaking && speakingMessageIndex === idx) {
      window.speechSynthesis.cancel();
      setSpeakingMessageIndex(null);
      return;
    }
    
    window.speechSynthesis.cancel();
    
    // Clean text from Markdown tags for speech synthesis
    const cleanText = text.replace(/[*#_`~]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const isHindi = /[\u0900-\u097F]/.test(text);
    const voices = window.speechSynthesis.getVoices();
    if (isHindi) {
      utterance.lang = "hi-IN";
      const hiVoice = voices.find(v => v.lang.includes("hi-"));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = navigator.language || "en-US";
    }
    
    utterance.onend = () => setSpeakingMessageIndex(null);
    utterance.onerror = () => setSpeakingMessageIndex(null);
    
    setSpeakingMessageIndex(idx);
    window.speechSynthesis.speak(utterance);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Safari.");
      return;
    }
    
    if (isListening) {
      setIsListening(false);
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    const isHindi = /[\u0900-\u097F]/.test(messages.map(m => m.content).join(" "));
    recognition.lang = isHindi ? "hi-IN" : "en-US";
    recognition.interimResults = false;
    
    recognition.onstart = () => {
      setIsListening(true);
    };
    
    recognition.onend = () => {
      setIsListening(false);
    };
    
    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInputText((prev) => (prev ? prev + " " + transcript : transcript));
    };
    
    recognition.start();
  };

  const speakTaskText = (text) => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeakingTask(false);
      return;
    }
    
    const cleanText = text.replace(/[*#_`~]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const isHindi = /[\u0900-\u097F]/.test(text);
    const voices = window.speechSynthesis.getVoices();
    if (isHindi) {
      utterance.lang = "hi-IN";
      const hiVoice = voices.find(v => v.lang.includes("hi-"));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = navigator.language || "en-US";
    }
    
    utterance.onend = () => setIsSpeakingTask(false);
    utterance.onerror = () => setIsSpeakingTask(false);
    
    setIsSpeakingTask(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleTestComplete = async (testType, results) => {
    let systemMessageText = "";
    if (testType === "motor") {
      systemMessageText = `SYSTEM: User completed the Motor (Spiral Tracing) test. Results: Stability Index = ${results.stability}%, Average Path Deviation = ${results.deviation}px, Tremor Classification = ${results.tremor}, Speed Jitter = ${results.jitter}, Completion Time = ${results.time}s.`;
    } else if (testType === "cognitive") {
      systemMessageText = `SYSTEM: User completed the Cognitive (Digit Span Recall) test. Results: Target Sequence = [${results.target}], User Input = [${results.userInput}], Distractor Task = ${results.distractorCorrect}, Recall Accuracy = ${results.accuracy}%.`;
    } else if (testType === "word_recognition") {
      systemMessageText = `SYSTEM: User completed the ADAS-COG Word Recognition test. Results: Target Words Correctly Selected = ${results.recalled}/8, Distractor Words Incorrectly Selected = ${results.falseAlarms}/8, Overall Accuracy = ${results.accuracy}%.`;
    } else if (testType === "clock_test") {
      systemMessageText = `SYSTEM: User completed the SLUMS Clock Drawing Test. Results: Time Setting Accuracy = ${results.accuracy}%, Hour Angle = ${results.hourAngle}°, Minute Angle = ${results.minuteAngle}°, Visuospatial Performance = ${results.performance}.`;
    } else if (testType === "faq") {
      systemMessageText = `SYSTEM: User completed the Functional Activities Questionnaire (FAQ). Results: Total FAQ Score = ${results.score}/30 (Cutoff >=9 indicates functional impairment). Details: ${results.details}.`;
    } else if (testType === "ryff") {
      systemMessageText = `SYSTEM: User completed the Ryff Psychological Well-being Scale. Results: Well-being Score = ${results.score}/84, Autonomy = ${results.autonomy}/14, Growth = ${results.growth}/14, Mastery = ${results.mastery}/14, Purpose = ${results.purpose}/14, Relations = ${results.relations}/14, Self-Acceptance = ${results.acceptance}/14, Well-being Rating = ${results.rating}%.`;
    } else if (testType === "mini_cog") {
      systemMessageText = `SYSTEM: User completed the Mini-Cog Assessment. Results: Three Word Recall = ${results.recall}/3, Clock Drawing Accuracy = ${results.clockAccuracy}%, Total Mini-Cog Score = ${results.score}/5 (Score < 3 indicates possible cognitive impairment).`;
    }
    
    // Close test modal
    setActiveTest(null);
    setSuggestedTest(null);
    
    // Send this as a hidden system message to the chat
    await sendMessage(systemMessageText);
  };

  // Safe simple markdown parser
  const renderMarkdown = (text) => {
    if (!text) return "";
    
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    const lines = html.split('\n');
    let output = [];
    let inList = false;
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (tableRows.length === 0) return "";
      
      const cleanRows = tableRows.filter(row => {
        const cells = row.split('|').map(c => c.trim());
        const isDivider = cells.slice(1, -1).every(cell => /^:?-+:?$/.test(cell));
        return !isDivider;
      });

      if (cleanRows.length === 0) {
        tableRows = [];
        return "";
      }

      let tableHtml = '<div class="report-table-container"><table class="report-table">';
      
      // Header
      const headerCells = cleanRows[0].split('|').slice(1, -1).map(c => c.trim());
      tableHtml += '<thead><tr>';
      headerCells.forEach(cell => {
        tableHtml += `<th>${cell}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';

      // Rows
      for (let i = 1; i < cleanRows.length; i++) {
        const cells = cleanRows[i].split('|').slice(1, -1).map(c => c.trim());
        tableHtml += '<tr>';
        cells.forEach(cell => {
          tableHtml += `<td>${cell}</td>`;
        });
        tableHtml += '</tr>';
      }
      
      tableHtml += '</tbody></table></div>';
      tableRows = [];
      return tableHtml;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // Table row check
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (inList) {
          output.push('</ul>');
          inList = false;
        }
        inTable = true;
        tableRows.push(trimmed);
        continue;
      } else if (inTable) {
        output.push(flushTable());
        inTable = false;
      }

      // List check
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          output.push('<ul class="report-list">');
          inList = true;
        }
        const itemContent = trimmed.substring(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        output.push(`<li>${itemContent}</li>`);
        continue;
      } else if (inList) {
        output.push('</ul>');
        inList = false;
      }

      // Horizontal lines
      if (trimmed === '---') {
        output.push('<hr class="report-hr" />');
        continue;
      }

      // Headers
      if (trimmed.startsWith('### ')) {
        output.push(`<h3>${trimmed.substring(4)}</h3>`);
      } else if (trimmed.startsWith('## ')) {
        output.push(`<h2>${trimmed.substring(3)}</h2>`);
      } else if (trimmed.startsWith('# ')) {
        output.push(`<h1>${trimmed.substring(2)}</h1>`);
      } else if (trimmed === '') {
        // Skip empty lines to prevent double spacing
      } else {
        const parsedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        output.push(`<p>${parsedLine}</p>`);
      }
    }

    if (inList) {
      output.push('</ul>');
    }
    if (inTable) {
      output.push(flushTable());
    }

    return output.filter(x => x !== "").join('\n');
  };

  const suggestedSymptoms = [
    "My hands are shaking, especially when resting",
    "I am having trouble remembering recent events",
    "I feel extreme anxiety and panic attacks",
    "I'm feeling very sad, low, and constantly fatigued"
  ];

  return (
    <div className="app-container">
      {/* Sidebar Panel */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="app-logo">
            <span>🧠 ManasMitra</span>
          </div>
          <div className="logo-sub">Pre-screening Assistant</div>
          <button className="new-chat-btn" onClick={startNewChat}>
            <span>+</span> Start New Chat
          </button>
        </div>

        {/* Loaded Clinical Guidelines */}
        <div className="docs-header">Loaded Medical References</div>
        <div className="docs-list">
          {documents.length > 0 ? (
            documents.map((doc, idx) => (
              <div key={idx} className="doc-item">
                <span className="doc-icon">📄</span>
                <span>{doc}</span>
              </div>
            ))
          ) : (
            <div className="doc-item" style={{ fontStyle: "italic" }}>
              Scanning folder for PDFs...
            </div>
          )}
        </div>

        {/* Chat History Threads */}
        <div className="docs-header">Conversations</div>
        <div className="threads-list">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`thread-item ${activeThreadId === t.id ? "active" : ""}`}
              onClick={() => setActiveThreadId(t.id)}
            >
              <div className="thread-title-container">
                <span className="thread-title">{t.title}</span>
              </div>
              <button
                className="delete-thread-btn"
                onClick={(e) => deleteThread(t.id, e)}
                title="Delete chat"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar Footer / API Key Settings */}
        <div className="sidebar-footer">
          <div className="api-key-input-container">
            <label className="api-key-label">Groq API Key</label>
            <input
              type="password"
              className="api-key-input"
              placeholder="gsk_..."
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
            />
          </div>
        </div>
      </aside>

      {/* Main Chat Panel */}
      <main className="chat-container">
        <div className="topbar">
          <div className="active-thread-info">
            <span className="active-thread-name">
              {threads.find((t) => t.id === activeThreadId)?.title || "Select or Start Chat"}
            </span>
            {activeThreadId && (
              <span className="active-thread-status">
                <span className="status-dot"></span> Pre-screening Active
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="btn-secondary"
              onClick={toggleTheme}
              title="Toggle Light/Dark Theme"
              style={{ fontSize: "1.2rem", padding: "8px 12px" }}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          </div>
        </div>

        {/* Message Log */}
        <div className="messages-viewport">
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-icon">💬</div>
              <h2 className="welcome-title">Empathetic Pre-screening</h2>
              <p className="welcome-desc">
                Welcome to ManasMitra. Share your symptoms below, and our pre-screening chatbot will ask guided questions based on our clinical documents to suggest next steps.
              </p>
              <div className="symptom-chips-container">
                {suggestedSymptoms.map((sym, idx) => (
                  <button
                    key={idx}
                    className="symptom-chip"
                    onClick={() => {
                      if (!activeThreadId) {
                        startNewChat().then(() => sendMessage(sym));
                      } else {
                        sendMessage(sym);
                      }
                    }}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div key={idx} className={`message-row ${m.role}`}>
                <div className="message-bubble-wrapper">
                  <div
                    className="message-bubble"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
                  {m.role === "assistant" && (
                    <button
                      className={`speech-btn ${speakingMessageIndex === idx ? "speaking" : ""}`}
                      onClick={() => handleSpeakToggle(m.content, idx)}
                      title={speakingMessageIndex === idx ? "Stop speaking" : "Speak message"}
                    >
                      {speakingMessageIndex === idx ? "⏹️" : "🔊"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Render Activity Recommendation prompt cards in message stream */}
          {suggestedTest === "motor" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>⚙️ Recommended Activity: Motor Stability</h3>
                <p>To help evaluate hand coordination or tremor indicators, please perform a quick spiral tracing test.</p>
                <button onClick={() => setActiveTest("motor")}>Start Spiral Tracing</button>
              </div>
            </div>
          )}

          {suggestedTest === "cognitive" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>🧠 Recommended Activity: Memory Recall</h3>
                <p>To evaluate working memory and recall, please complete a short Digit Span memory game.</p>
                <button onClick={() => setActiveTest("cognitive")}>Start Cognitive Test</button>
              </div>
            </div>
          )}

          {suggestedTest === "word_recognition" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>📇 Recommended Activity: Word Recognition</h3>
                <p>To evaluate short-term recognition memory, please complete a brief ADAS-COG Word Recognition test.</p>
                <button onClick={() => setActiveTest("word_recognition")}>Start Word Test</button>
              </div>
            </div>
          )}

          {suggestedTest === "clock_test" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>🕰️ Recommended Activity: Clock Setting</h3>
                <p>To evaluate visuospatial and executive function, please perform a brief interactive Clock Setting test.</p>
                <button onClick={() => setActiveTest("clock_test")}>Start Clock Test</button>
              </div>
            </div>
          )}

          {suggestedTest === "faq" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>📋 Recommended Activity: Functional Activities Checklist</h3>
                <p>To evaluate daily activity independence, please complete a short Functional Activities Questionnaire.</p>
                <button onClick={() => setActiveTest("faq")}>Start FAQ Checklist</button>
              </div>
            </div>
          )}

          {suggestedTest === "ryff" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>🌸 Recommended Activity: Psychological Well-being</h3>
                <p>To evaluate emotional strength and resilience, please complete a short Ryff Psychological Well-being screener.</p>
                <button onClick={() => setActiveTest("ryff")}>Start RYFF Assessment</button>
              </div>
            </div>
          )}

          {suggestedTest === "mini_cog" && (
            <div className="message-row assistant">
              <div className="activity-card">
                <h3>⚡ Recommended Activity: Mini-Cog Assessment</h3>
                <p>To evaluate cognitive function through a quick recall and clock test, please complete a 3-minute Mini-Cog screen.</p>
                <button onClick={() => setActiveTest("mini_cog")}>Start Mini-Cog Test</button>
              </div>
            </div>
          )}

          {isComplete && (
            <div className="message-row assistant">
              <div className="activity-card" style={{ border: "1px solid var(--success)", background: "rgba(16, 185, 129, 0.05)" }}>
                <h3>📋 Pre-screening Complete</h3>
                <p>All diagnostic criteria have been explored. You can now generate a detailed clinical summary report containing your symptom analysis and activity metrics.</p>
                {isGeneratingReport ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-muted)", padding: "10px 0" }}>
                    <span className="typing-dot" style={{ animationDelay: "-0.32s" }}></span>
                    <span className="typing-dot" style={{ animationDelay: "-0.16s" }}></span>
                    <span className="typing-dot"></span>
                    <span>Generating clinical report...</span>
                  </div>
                ) : report ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                    <strong style={{ color: "var(--success)", fontSize: "0.95rem" }}>✓ Pre-screening Report Generated!</strong>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button onClick={() => setReport(report)} style={{ background: "var(--accent-gradient)" }}>👁️ View Report</button>
                      <button className="btn-secondary" onClick={downloadReport} style={{ padding: "8px 12px" }}>💾 Download MD</button>
                      <button className="btn-secondary" onClick={printReport} style={{ padding: "8px 12px" }}>🖨️ Print</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={generateReport}>📊 Generate Report</button>
                )}
              </div>
            </div>
          )}

          {isTyping && (
            <div className="message-row assistant">
              <div className="typing-bubble">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Panel */}
        <div className="input-panel">
          <div className="input-container">
            <textarea
              className="chat-input"
              placeholder={
                activeThreadId
                  ? (suggestedTest ? "Please complete the recommended activity above..." : "Describe your symptoms (e.g. hand shaking, forgetfulness)...")
                  : "Start a chat in the sidebar to begin pre-screening"
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={!activeThreadId || isTyping || suggestedTest !== null}
              rows="1"
            />
            {activeThreadId && !suggestedTest && (
              <button
                className={`mic-btn ${isListening ? "listening" : ""}`}
                onClick={startListening}
                title={isListening ? "Stop listening" : "Speak to type"}
                type="button"
              >
                🎙️
              </button>
            )}
            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={!activeThreadId || isTyping || suggestedTest !== null || !inputText.trim()}
            >
              ➔
            </button>
          </div>
        </div>
      </main>

      {/* Report Panel overlay */}
      {report && (
        <div className="report-overlay">
          <div className="report-header">
            <span className="report-title-text">Pre-screening Report</span>
            <button className="close-report-btn" onClick={() => setReport(null)}>
              ✕
            </button>
          </div>
          <div className="report-body">
            <div className="warning-box">
              <strong>Disclaimer</strong>
              This pre-screening report is automatically compiled based on your self-reported symptoms.
              It is NOT a professional diagnosis. Please share this report and discuss these details with a qualified medical specialist.
            </div>
            <div
              className="report-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(report) }}
            />
          </div>
          <div className="report-actions">
            <button className="btn-secondary" onClick={downloadReport}>
              💾 Download MD
            </button>
            <button className="btn-primary" onClick={printReport}>
              🖨️ Print Report
            </button>
          </div>
        </div>
      )}

      {/* Interactive Clinical Test Modals */}
      {activeTest === "motor" && (
        <SpiralTracingModal
          onComplete={(res) => handleTestComplete("motor", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "cognitive" && (
        <CognitiveModal
          onComplete={(res) => handleTestComplete("cognitive", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "word_recognition" && (
        <WordRecognitionModal
          onComplete={(res) => handleTestComplete("word_recognition", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "clock_test" && (
        <ClockTestModal
          onComplete={(res) => handleTestComplete("clock_test", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "faq" && (
        <FAQModal
          onComplete={(res) => handleTestComplete("faq", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "ryff" && (
        <RYFFModal
          onComplete={(res) => handleTestComplete("ryff", res)}
          onClose={() => setActiveTest(null)}
        />
      )}

      {activeTest === "mini_cog" && (
        <MiniCogModal
          onComplete={(res) => handleTestComplete("mini_cog", res)}
          onClose={() => setActiveTest(null)}
        />
      )}
    </div>
  );
}

// ==========================================
// INTERACTIVE CLINICAL TEST COMPONENTS
// ==========================================

function SpiralTracingModal({ onComplete, onClose }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState([]);
  const [startTime, setStartTime] = useState(null);
  const [isFinished, setIsFinished] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Draw the faint dashed reference spiral
    ctx.clearRect(0, 0, 400, 400);
    const isLight = document.documentElement.classList.contains("light-mode");
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    
    const xc = 200, yc = 200;
    const a = 12; // Spiral spacing factor
    for (let theta = 0; theta < 4.5 * Math.PI; theta += 0.02) {
      const r = a * theta;
      const x = xc + r * Math.cos(theta);
      const y = yc + r * Math.sin(theta);
      if (theta === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleStart = (e) => {
    if (isFinished) return;
    const coords = getCanvasCoords(e);
    setIsDrawing(true);
    setPoints([coords]);
    if (!startTime) setStartTime(Date.now());
  };

  const handleMove = (e) => {
    if (!isDrawing || isFinished) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const coords = getCanvasCoords(e);
    const prevPoint = points[points.length - 1];

    ctx.strokeStyle = "#a855f7"; // purple accent
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(prevPoint.x, prevPoint.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    setPoints((prev) => [...prev, coords]);
  };

  const handleEnd = () => {
    if (!isDrawing || isFinished) return;
    setIsDrawing(false);

    if (points.length < 20) return;
    const lastPoint = points[points.length - 1];
    const dx = lastPoint.x - 200;
    const dy = lastPoint.y - 200;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist > 140) {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      
      let totalDeviation = 0;
      points.forEach(p => {
        const pdx = p.x - 200;
        const pdy = p.y - 200;
        const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
        const ptheta = Math.atan2(pdy, pdx);
        
        const a = 12;
        let minDiff = Infinity;
        for (let turn = 0; turn < 3; turn++) {
          const idealTheta = ptheta + turn * 2 * Math.PI;
          if (idealTheta >= 0 && idealTheta <= 4.5 * Math.PI) {
            const idealR = a * idealTheta;
            const diff = Math.abs(pdist - idealR);
            if (diff < minDiff) minDiff = diff;
          }
        }
        totalDeviation += minDiff;
      });

      const avgDeviation = (totalDeviation / points.length).toFixed(1);
      const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - avgDeviation * 2.5)));
      
      let speeds = [];
      for (let i = 1; i < points.length; i++) {
        const s_dx = points[i].x - points[i-1].x;
        const s_dy = points[i].y - points[i-1].y;
        speeds.push(Math.sqrt(s_dx*s_dx + s_dy*s_dy));
      }
      const meanSpeed = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
      const speedVariance = speeds.reduce((sum, s) => sum + Math.pow(s - meanSpeed, 2), 0) / speeds.length;
      const speedJitter = Math.sqrt(speedVariance).toFixed(2);
      
      let tremorClassification = "Low (Normal)";
      if (speedJitter > 2.5) tremorClassification = "High (Moderate/Severe Tremor)";
      else if (speedJitter > 1.2) tremorClassification = "Medium (Mild Tremor)";

      const res = {
        stability: stabilityScore,
        deviation: avgDeviation,
        time: durationSec,
        tremor: tremorClassification,
        jitter: speedJitter
      };

      setResults(res);
      setIsFinished(true);
    }
  };

  const resetCanvas = () => {
    setPoints([]);
    setStartTime(null);
    setIsFinished(false);
    setResults(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 400, 400);
    const isLight = document.documentElement.classList.contains("light-mode");
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const xc = 200, yc = 200;
    const a = 12;
    for (let theta = 0; theta < 4.5 * Math.PI; theta += 0.02) {
      const r = a * theta;
      const x = xc + r * Math.cos(theta);
      const y = yc + r * Math.sin(theta);
      if (theta === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal">
        <div className="activity-modal-header">
          <span className="activity-modal-title">⚙️ Motor Stability Assessment</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>
        <div className="activity-modal-body">
          {!isFinished ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", marginBottom: "8px" }}>
                <p style={{ margin: 0, flex: 1 }}>Place your cursor/finger at the center dot and trace the dashed spiral line outward to the outer edge without lifting.</p>
                <button
                  className="modal-speak-btn"
                  onClick={() => speakTaskText("Place your cursor or finger at the center dot and trace the dashed spiral line outward to the outer edge without lifting.")}
                  title="Read aloud"
                  style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
                >
                  🔊
                </button>
              </div>
              <div className="spiral-canvas-container">
                <canvas
                  ref={canvasRef}
                  width="400"
                  height="400"
                  className="spiral-canvas"
                  onMouseDown={handleStart}
                  onMouseMove={handleMove}
                  onMouseUp={handleEnd}
                  onTouchStart={handleStart}
                  onTouchMove={handleMove}
                  onTouchEnd={handleEnd}
                />
                <div style={{
                  position: "absolute",
                  left: "196px",
                  top: "196px",
                  width: "8px",
                  height: "8px",
                  background: "#6366f1",
                  borderRadius: "50%"
                }}></div>
              </div>
              <button className="btn-secondary" onClick={resetCanvas}>Clear and Retry</button>
            </>
          ) : (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px", textAlign: "left" }}>
              <h3 style={{ color: "#10b981", textAlign: "center" }}>Test Completed Successfully!</h3>
              <div style={{ background: "var(--input-bg)", border: "1px solid var(--glass-border)", padding: "16px", borderRadius: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
                  <span>Stability Index:</span>
                  <strong style={{ color: results.stability > 75 ? "#10b981" : "#ef4444" }}>{results.stability}%</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
                  <span>Avg Path Deviation:</span>
                  <strong>{results.deviation} px</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
                  <span>Time taken:</span>
                  <strong>{results.time}s</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 0" }}>
                  <span>Tremor/Jitter Level:</span>
                  <strong style={{ color: results.tremor.includes("Low") ? "#10b981" : "#f59e0b" }}>{results.tremor}</strong>
                </div>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Click 'Submit Results' below to record these metrics in the session report.
              </p>
            </div>
          )}
        </div>
        <div className="activity-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {isFinished && (
            <button className="btn-primary" onClick={() => onComplete(results)}>Submit Results</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CognitiveModal({ onComplete, onClose }) {
  const [step, setStep] = useState('intro');
  const [digits, setDigits] = useState([]);
  const [countdown, setCountdown] = useState(4);
  const [distractorAns, setDistractorAns] = useState(null);
  const [userDigits, setUserDigits] = useState('');
  const [modalListening, setModalListening] = useState(false);

  const startModalListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setModalListening(true);
    recognition.onend = () => setModalListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const cleanDigits = transcript.replace(/\s+/g, "").replace(/[^0-9]/g, '');
      setUserDigits(cleanDigits);
    };
    recognition.start();
  };
  
  const startTest = () => {
    const list = [];
    for (let i = 0; i < 5; i++) {
      list.push(Math.floor(Math.random() * 10));
    }
    setDigits(list);
    setStep('display');
    setCountdown(4);
  };

  useEffect(() => {
    if (step !== 'display') return;
    if (countdown <= 0) {
      setStep('distractor');
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, step]);

  const handleDistractorSubmit = (ans) => {
    setDistractorAns(ans);
    setStep('recall');
  };

  const handleRecallSubmit = () => {
    const cleanedInput = userDigits.replace(/\s+/g, "");
    const reversedTarget = [...digits].reverse().join("");
    
    let correctCount = 0;
    for (let i = 0; i < Math.min(cleanedInput.length, reversedTarget.length); i++) {
      if (cleanedInput[i] === reversedTarget[i]) correctCount++;
    }
    
    const accuracy = Math.round((correctCount / 5) * 100);
    const distractorCorrect = distractorAns === 11;

    const results = {
      target: digits.join(", "),
      reverseTarget: reversedTarget,
      userInput: userDigits,
      distractorCorrect: distractorCorrect ? "Correct" : "Incorrect",
      accuracy: accuracy
    };
    
    onComplete(results);
  };

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal">
        <div className="activity-modal-header">
          <span className="activity-modal-title">🧠 Cognitive Memory Assessment</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="activity-modal-body">
          {step === 'intro' && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", marginBottom: "8px" }}>
                <p style={{ margin: 0, flex: 1 }}>This is a standard Digit Span backward memory recall test based on the SLUMS clinical framework.</p>
                <button
                  className="modal-speak-btn"
                  onClick={() => speakTaskText("This is a standard Digit Span backward memory recall test based on the SLUMS clinical framework. You will see 5 random numbers on screen. Memorize them. You will then solve a simple distractor problem, and finally type the numbers in reverse order.")}
                  title="Read aloud"
                  style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
                >
                  🔊
                </button>
              </div>
              <p style={{ fontStyle: "italic", fontSize: "0.85rem" }}>You will see 5 random numbers on screen. Memorize them. You will then solve a simple distractor problem, and finally type the numbers in **REVERSE (backward) order**.</p>
              <button className="btn-primary" onClick={startTest} style={{ marginTop: "10px" }}>Start Memory Test</button>
            </>
          )}

          {step === 'display' && (
            <>
              <p>Memorize these numbers:</p>
              <div className="digit-display-box">
                {digits.join(" ")}
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Disappearing in <strong>{countdown}s</strong>...</p>
            </>
          )}

          {step === 'distractor' && (
            <>
              <p><strong>Distractor Task:</strong> Solve this simple calculation (tests active working memory distraction):</p>
              <div className="distractor-box">
                <div className="distractor-question">What is 14 - 6 + 3 ?</div>
                <div className="distractor-options">
                  {[9, 11, 13, 15].map(opt => (
                    <button
                      key={opt}
                      className="distractor-btn"
                      onClick={() => handleDistractorSubmit(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 'recall' && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", marginBottom: "8px" }}>
                <p style={{ margin: 0, flex: 1 }}>Type the 5 numbers you saw in **REVERSE (backward)** order:</p>
                <button
                  className="modal-speak-btn"
                  onClick={() => speakTaskText("Type the 5 numbers you saw in reverse order.")}
                  title="Read aloud"
                  style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
                >
                  🔊
                </button>
              </div>
              <div style={{ display: "flex", gap: "10px", width: "100%", alignItems: "center" }}>
                <input
                  type="text"
                  maxLength={5}
                  className="digit-recall-input"
                  placeholder="....."
                  value={userDigits}
                  onChange={(e) => setUserDigits(e.target.value.replace(/[^0-9]/g, ''))}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button
                  className={`mic-btn ${modalListening ? "listening" : ""}`}
                  onClick={startModalListening}
                  title={modalListening ? "Stop listening" : "Speak digits"}
                  type="button"
                  style={{ width: "48px", height: "48px", borderRadius: "12px", border: "1px solid var(--glass-border)", background: "var(--input-bg)", fontSize: "1.2rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                >
                  🎙️
                </button>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                For example, if you saw "1 2 3 4 5", type "54321".
              </p>
            </>
          )}
        </div>

        <div className="activity-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {step === 'recall' && (
            <button className="btn-primary" disabled={userDigits.length < 5} onClick={handleRecallSubmit}>Submit Results</button>
          )}
        </div>
      </div>
    </div>
  );
}

function WordRecognitionModal({ onComplete, onClose }) {
  const [step, setStep] = useState('intro'); // intro -> display -> distraction -> select
  const [selectedWords, setSelectedWords] = useState([]);
  const [distractionAns, setDistractionAns] = useState(null);
  
  const targetWords = ["Apple", "Pen", "Tie", "House", "Car", "River", "Cable", "Forest"];
  const distractorWords = ["Window", "Tree", "Table", "Stream", "Cup", "Wire", "Watch", "Mountain"];
  const [shuffledWords, setShuffledWords] = useState([]);
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    if (step === 'select') {
      const all = [...targetWords, ...distractorWords];
      setShuffledWords(all.sort(() => Math.random() - 0.5));
    }
  }, [step]);

  useEffect(() => {
    if (step !== 'display') return;
    if (countdown <= 0) {
      setStep('distraction');
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, countdown]);

  const toggleWord = (word) => {
    if (selectedWords.includes(word)) {
      setSelectedWords(selectedWords.filter(w => w !== word));
    } else {
      setSelectedWords([...selectedWords, word]);
    }
  };

  const handleDistractionSubmit = (ans) => {
    setDistractionAns(ans);
    setStep('select');
  };

  const handleSubmit = () => {
    const hits = selectedWords.filter(w => targetWords.includes(w)).length;
    const falseAlarms = selectedWords.filter(w => distractorWords.includes(w)).length;
    const accuracy = Math.max(0, Math.round(((hits - falseAlarms) / targetWords.length) * 100));

    const results = {
      recalled: hits,
      falseAlarms: falseAlarms,
      accuracy: accuracy,
      selected: selectedWords.join(", ")
    };

    onComplete(results);
  };

  const speakTaskText = (text) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal" style={{ maxWidth: "550px" }}>
        <div className="activity-modal-header">
          <span className="activity-modal-title">📇 ADAS-COG Word Recognition</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="activity-modal-body" style={{ minHeight: "260px", justifyContent: "center" }}>
          {step === 'intro' && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", marginBottom: "8px" }}>
                <p style={{ margin: 0, flex: 1 }}>This is a standard Word Recognition memory screener based on the clinical ADAS-COG framework.</p>
                <button
                  className="modal-speak-btn"
                  onClick={() => speakTaskText("This is a standard Word Recognition memory screener based on the clinical ADAS-COG framework. You will see 8 simple words together. Pay close attention to them for 8 seconds. After a distraction task, you will be shown a grid of words and must select only the ones you saw.")}
                  title="Read aloud"
                  style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
                >
                  🔊
                </button>
              </div>
              <p style={{ fontStyle: "italic", fontSize: "0.85rem" }}>You will see 8 simple words together. Pay close attention to them for 8 seconds. After a distraction task, you will be shown a grid of words and must select only the ones you saw.</p>
              <button className="btn-primary" onClick={() => { setCountdown(8); setStep('display'); }} style={{ marginTop: "10px" }}>Start Word Test</button>
            </>
          )}

          {step === 'display' && (
            <>
              <p>Observe and memorize these words:</p>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "12px",
                width: "100%",
                padding: "20px",
                background: "rgba(99, 102, 241, 0.1)",
                borderRadius: "12px",
                border: "1px solid var(--accent-primary)",
                fontSize: "1.4rem",
                fontWeight: "700",
                color: "#fff",
                textAlign: "center"
              }}>
                {targetWords.map((w, idx) => (
                  <div key={idx} style={{ textShadow: "0 0 8px rgba(99, 102, 241, 0.4)" }}>{w}</div>
                ))}
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "12px" }}>Disappearing in <strong>{countdown}s</strong>...</p>
            </>
          )}

          {step === 'distraction' && (
            <>
              <p><strong>Distraction Task:</strong> Solve this quick puzzle before recalling (tests active working memory):</p>
              <div className="distractor-box" style={{ width: "100%", marginTop: "10px" }}>
                <div className="distractor-question" style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "15px" }}>Which of these colors is a primary color?</div>
                <div className="distractor-options" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {["Green", "Orange", "Yellow", "Purple"].map(opt => (
                    <button
                      key={opt}
                      className="distractor-btn"
                      style={{ padding: "12px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "var(--glass-bg)", color: "var(--text-main)", cursor: "pointer", fontSize: "1rem" }}
                      onClick={() => handleDistractionSubmit(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 'select' && (
            <>
              <p style={{ marginBottom: "6px" }}>Select the words that you were shown in the first screen:</p>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "8px",
                width: "100%",
                maxHeight: "240px",
                overflowY: "auto",
                padding: "8px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: "12px",
                border: "1px solid var(--glass-border)"
              }}>
                {shuffledWords.map(word => {
                  const isSel = selectedWords.includes(word);
                  return (
                    <button
                      key={word}
                      onClick={() => toggleWord(word)}
                      style={{
                        padding: "10px 4px",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: isSel ? "var(--accent-primary)" : "var(--glass-border)",
                        background: isSel ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.02)",
                        color: isSel ? "#fff" : "var(--text-muted)",
                        fontSize: "0.85rem",
                        fontWeight: isSel ? "700" : "500",
                        cursor: "pointer",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Selected: {selectedWords.length} words
              </p>
            </>
          )}
        </div>

        <div className="activity-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {step === 'select' && (
            <button className="btn-primary" onClick={handleSubmit}>Submit Results</button>
          )}
        </div>
      </div>
    </div>
  );
}

function RYFFModal({ onComplete, onClose }) {
  const RYFF_QUESTIONS = [
    { id: "q1", text: "I am not afraid to voice my opinions, even when they are in opposition to the opinions of most people.", category: "autonomy", positive: true },
    { id: "q2", text: "For me, life has been a continuous process of learning, changing, and growth.", category: "growth", positive: true },
    { id: "q3", text: "In general, I feel I am in charge of the situation in which I live.", category: "mastery", positive: true },
    { id: "q4", text: "People would describe me as a giving person, willing to share my time with others.", category: "relations", positive: true },
    { id: "q5", text: "I enjoy making plans for the future and working to make them a reality.", category: "purpose", positive: true },
    { id: "q6", text: "In many ways I feel disappointed about my achievements in life.", category: "acceptance", positive: false },
    { id: "q7", text: "I live life one day at a time and don't really think about the future.", category: "purpose", positive: false },
    { id: "q8", text: "I tend to worry about what other people think of me.", category: "autonomy", positive: false },
    { id: "q9", text: "When I look at the story of my life, I am pleased with how things have turned out.", category: "acceptance", positive: true },
    { id: "q10", text: "I have difficulty arranging my life in a way that is satisfying to me.", category: "mastery", positive: false },
    { id: "q11", text: "Maintaining close relationships has been difficult and frustrating for me.", category: "relations", positive: false },
    { id: "q12", text: "I think it is important to have new experiences that challenge how you think about yourself and the world.", category: "growth", positive: true }
  ];

  const OPTIONS = [
    { val: 7, label: "Strongly Agree" },
    { val: 6, label: "Somewhat Agree" },
    { val: 5, label: "A Little Agree" },
    { val: 4, label: "Neither Agree or Disagree" },
    { val: 3, label: "A Little Disagree" },
    { val: 2, label: "Somewhat Disagree" },
    { val: 1, label: "Strongly Disagree" }
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [scores, setScores] = useState({});

  const handleScoreSelect = (scoreVal) => {
    const q = RYFF_QUESTIONS[currentStep];
    setScores((prev) => ({ ...prev, [q.id]: scoreVal }));

    if (currentStep < RYFF_QUESTIONS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleNext = () => {
    if (currentStep < RYFF_QUESTIONS.length - 1) setCurrentStep(currentStep + 1);
  };

  const handleSubmit = () => {
    let totalScore = 0;
    let categoryScores = { autonomy: 0, growth: 0, mastery: 0, relations: 0, purpose: 0, acceptance: 0 };

    RYFF_QUESTIONS.forEach((q) => {
      let val = scores[q.id] !== undefined ? scores[q.id] : 4;
      if (!q.positive) {
        val = 8 - val; // Reverse score
      }
      totalScore += val;
      categoryScores[q.category] += val;
    });

    const rating = Math.round((totalScore / 84) * 100);

    onComplete({
      score: totalScore,
      autonomy: categoryScores.autonomy,
      growth: categoryScores.growth,
      mastery: categoryScores.mastery,
      relations: categoryScores.relations,
      purpose: categoryScores.purpose,
      acceptance: categoryScores.acceptance,
      rating: rating
    });
  };

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal" style={{ maxWidth: "550px" }}>
        <div className="activity-modal-header">
          <span className="activity-modal-title">🌸 Ryff Psychological Well-being Scale</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>

        <div className="activity-modal-body" style={{ textAlign: "left", alignItems: "stretch" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            <span>Question {currentStep + 1} of 12</span>
            <span>Progress: {Math.round(((currentStep + 1) / 12) * 100)}%</span>
          </div>

          <div style={{ height: "4px", background: "var(--glass-border)", borderRadius: "2px", margin: "8px 0 20px 0", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${((currentStep + 1) / 12) * 100}%`, background: "var(--accent-gradient)", transition: "width 0.3s ease" }}></div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "space-between", marginBottom: "16px" }}>
            <h4 style={{ fontSize: "1.1rem", margin: 0, lineHeight: "1.4", color: "var(--text-highlight)", flex: 1 }}>
              "{RYFF_QUESTIONS[currentStep].text}"
            </h4>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
            {OPTIONS.map((opt) => {
              const isSelected = currentSelectedScore === opt.val;
              const currentSelectedScore = scores[RYFF_QUESTIONS[currentStep].id];
              return (
                <button
                  key={opt.val}
                  onClick={() => handleScoreSelect(opt.val)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid",
                    borderColor: isSelected ? "var(--accent-primary)" : "var(--glass-border)",
                    background: isSelected ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.02)",
                    color: isSelected ? "#fff" : "var(--text-main)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.85rem",
                    transition: "all 0.2s ease",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <span>{opt.label}</span>
                  {isSelected && <span style={{ color: "var(--accent-primary)" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="activity-modal-footer" style={{ justifyContent: "space-between" }}>
          <div>
            <button className="btn-secondary" onClick={handlePrev} disabled={currentStep === 0}>
              Previous
            </button>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {currentStep < RYFF_QUESTIONS.length - 1 ? (
              <button className="btn-secondary" onClick={handleNext} disabled={scores[RYFF_QUESTIONS[currentStep].id] === undefined}>
                Next
              </button>
            ) : (
              <button className="btn-primary" onClick={handleSubmit} disabled={!isAllAnswered}>
                Complete & Submit
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCogModal({ onComplete, onClose }) {
  const [step, setStep] = useState('intro'); // intro -> display -> distractor -> recall
  const [selectedWords, setSelectedWords] = useState([]);
  const [countdown, setCountdown] = useState(4);
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [activeSetting, setActiveSetting] = useState("hour");
  const svgRef = useRef(null);

  const targetWords = ["Captain", "Garden", "Picture"];
  const optionsList = ["Captain", "Garden", "Picture", "Banana", "Sunrise", "Chair", "Leader", "Baby", "River", "Finger"];

  const calculateAngle = (clientX, clientY) => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let angleRad = Math.atan2(dy, dx);
    let angleDeg = (angleRad * 180) / Math.PI + 90;
    if (angleDeg < 0) angleDeg += 360;
    return angleDeg;
  };

  const handleSvgInteraction = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deg = calculateAngle(clientX, clientY);

    if (activeSetting === "hour") {
      let hVal = deg / 30;
      if (hVal === 0) hVal = 12;
      setHour(parseFloat(hVal.toFixed(1)));
    } else {
      let mVal = Math.round(deg / 6);
      if (mVal >= 60) mVal = 0;
      setMinute(mVal);
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches && e.touches.length > 0) {
      handleSvgInteraction(e);
    }
  };

  useEffect(() => {
    if (step !== 'display') return;
    if (countdown <= 0) {
      setStep('distractor');
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, step]);

  const toggleWord = (word) => {
    if (selectedWords.includes(word)) {
      setSelectedWords(selectedWords.filter(w => w !== word));
    } else {
      setSelectedWords([...selectedWords, word]);
    }
  };

  const handleSubmit = () => {
    const hits = selectedWords.filter(w => targetWords.includes(w)).length;
    const falseAlarms = selectedWords.filter(w => !targetWords.includes(w)).length;
    const recallScore = Math.max(0, hits - falseAlarms);

    const hDiff = Math.min(Math.abs(hour - 11), 12 - Math.abs(hour - 11));
    const mDiff = Math.min(Math.abs(minute - 10), 60 - Math.abs(minute - 10));
    
    let clockAccuracy = 100;
    if (hDiff > 0.3 || mDiff > 3) {
      clockAccuracy = Math.round(Math.max(0, 100 - (hDiff * 25 + mDiff * 1.5)));
    }
    
    const clockScore = clockAccuracy >= 85 ? 2 : 0;

    const results = {
      recall: recallScore,
      clockAccuracy: clockAccuracy,
      score: recallScore + clockScore,
    };

    onComplete(results);
  };

  const hrRad = ((hour % 12) * 30 + minute * 0.5 - 90) * (Math.PI / 180);
  const minRad = (minute * 6 - 90) * (Math.PI / 180);

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal">
        <div className="activity-modal-header">
          <span className="activity-modal-title">⚡ Mini-Cog Assessment</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>

        <div className="activity-modal-body" style={{ minHeight: "280px" }}>
          {step === 'intro' && (
            <>
              <p>This is a standard 3-minute Mini-Cog cognitive screening instrument.</p>
              <p style={{ fontStyle: "italic", fontSize: "0.85rem" }}>You will register 3 simple words, perform an interactive Clock Drawing distractor task, and then recall the original 3 words.</p>
              <button className="btn-primary" onClick={() => { setCountdown(4); setStep('display'); }} style={{ marginTop: "10px" }}>Start Mini-Cog</button>
            </>
          )}

          {step === 'display' && (
            <>
              <p>Remember these 3 words:</p>
              <div className="digit-display-box" style={{ fontSize: "2rem", display: "flex", gap: "15px", justifyContent: "center", letterSpacing: "normal" }}>
                {targetWords.map((w, i) => <span key={i}>{w}</span>)}
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "10px" }}>Disappearing in <strong>{countdown}s</strong>...</p>
            </>
          )}

          {step === 'distractor' && (
            <>
              <p><strong>Distraction Task:</strong> Set the clock to show <strong>10 past 11 (11:10)</strong>.</p>
              
              <div style={{ display: "flex", gap: "8px", margin: "5px 0" }}>
                <button
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid",
                    borderColor: activeSetting === "hour" ? "var(--accent-primary)" : "var(--glass-border)",
                    background: activeSetting === "hour" ? "rgba(99, 102, 241, 0.2)" : "rgba(255,255,255,0.02)",
                    color: activeSetting === "hour" ? "#fff" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: "600"
                  }}
                  onClick={() => setActiveSetting("hour")}
                >
                  Hour Hand
                </button>
                <button
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid",
                    borderColor: activeSetting === "minute" ? "var(--accent-secondary)" : "var(--glass-border)",
                    background: activeSetting === "minute" ? "rgba(168, 85, 247, 0.2)" : "rgba(255,255,255,0.02)",
                    color: activeSetting === "minute" ? "#fff" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: "600"
                  }}
                  onClick={() => setActiveSetting("minute")}
                >
                  Minute Hand
                </button>
              </div>

              <div style={{ position: "relative", width: "160px", height: "160px", userSelect: "none" }}>
                <svg
                  ref={svgRef}
                  width="160"
                  height="160"
                  style={{ cursor: "pointer", overflow: "visible" }}
                  onMouseDown={handleSvgInteraction}
                  onTouchStart={handleSvgInteraction}
                  onTouchMove={handleTouchMove}
                >
                  <circle cx="80" cy="80" r="70" fill="rgba(0,0,0,0.4)" stroke="var(--text-main)" strokeWidth="3" />
                  <circle cx="80" cy="80" r="4" fill="var(--accent-primary)" />
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => {
                    const angle = (num * 30 - 90) * (Math.PI / 180);
                    const nx = 80 + 58 * Math.cos(angle);
                    const ny = 80 + 58 * Math.sin(angle);
                    return (
                      <text key={num} x={nx} y={ny + 3} textAnchor="middle" fill="var(--text-main)" fontSize="10" fontWeight="700">
                        {num}
                      </text>
                    );
                  })}
                  
                  <line x1="80" y1="80" x2={80 + 30 * Math.cos(hrRad)} y2={80 + 30 * Math.sin(hrRad)} stroke="#a855f7" strokeWidth="4" strokeLinecap="round" />
                  <line x1="80" y1="80" x2={80 + 50 * Math.cos(minRad)} y2={80 + 50 * Math.sin(minRad)} stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>

              <div style={{ margin: "5px 0" }}>
                <strong style={{ fontSize: "1rem" }}>Time: {Math.floor(hour)}:{minute.toString().padStart(2, "0")}</strong>
              </div>

              <button className="btn-primary" onClick={() => setStep('recall')} style={{ fontSize: "0.85rem", padding: "6px 12px" }}>Next: Recall Words</button>
            </>
          )}

          {step === 'recall' && (
            <>
              <p>Select the 3 words you memorized earlier:</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", width: "100%", margin: "10px 0" }}>
                {optionsList.map(word => {
                  const isSel = selectedWords.includes(word);
                  return (
                    <button
                      key={word}
                      onClick={() => toggleWord(word)}
                      style={{
                        padding: "8px",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: isSel ? "var(--accent-primary)" : "var(--glass-border)",
                        background: isSel ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.02)",
                        color: isSel ? "#fff" : "var(--text-muted)",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                      }}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="activity-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {step === 'recall' && (
            <button className="btn-primary" onClick={handleSubmit} disabled={selectedWords.length === 0}>Submit Results</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ClockTestModal({ onComplete, onClose }) {
  const [activeSetting, setActiveSetting] = useState("hour"); // "hour" or "minute"
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const svgRef = useRef(null);

  const calculateAngle = (clientX, clientY) => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let angleRad = Math.atan2(dy, dx);
    let angleDeg = (angleRad * 180) / Math.PI + 90;
    if (angleDeg < 0) angleDeg += 360;
    return angleDeg;
  };

  const handleSvgInteraction = (e) => {
    if (isFinished) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deg = calculateAngle(clientX, clientY);

    if (activeSetting === "hour") {
      let hVal = deg / 30;
      if (hVal === 0) hVal = 12;
      setHour(parseFloat(hVal.toFixed(1)));
    } else {
      let mVal = Math.round(deg / 6);
      if (mVal >= 60) mVal = 0;
      setMinute(mVal);
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches && e.touches.length > 0) {
      handleSvgInteraction(e);
    }
  };

  const handleSubmit = () => {
    // Target is 10:00
    // Ideal Hour Hand: 10
    // Ideal Minute Hand: 0 (or 60)
    const hDiff = Math.min(Math.abs(hour - 10), 12 - Math.abs(hour - 10));
    const mDiff = Math.min(Math.abs(minute - 0), 60 - Math.abs(minute - 0));

    // Calculate score (100 max)
    // Accept small deviation. 0.25 hour (15 mins) and 2 minutes deviation is ok.
    let accuracy = 100;
    if (hDiff > 0.25 || mDiff > 2) {
      accuracy = Math.round(Math.max(0, 100 - (hDiff * 25 + mDiff * 1.5)));
    }

    const hourAngle = (hour % 12) * 30 + minute * 0.5;
    const minuteAngle = minute * 6;

    let performance = "Normal / No Impairment";
    if (accuracy < 70) {
      performance = "Moderate/Severe Visuospatial Impairment";
    } else if (accuracy < 85) {
      performance = "Mild Visuospatial Impairment";
    }

    const results = {
      accuracy,
      hourAngle: Math.round(hourAngle),
      minuteAngle: Math.round(minuteAngle),
      performance,
      timeString: `${Math.floor(hour)}:${minute.toString().padStart(2, "0")}`
    };

    onComplete(results);
  };

  // SVG Coordinates for Hands
  const hrRad = ((hour % 12) * 30 + minute * 0.5 - 90) * (Math.PI / 180);
  const minRad = (minute * 6 - 90) * (Math.PI / 180);

  const hrX = 120 + 45 * Math.cos(hrRad);
  const hrY = 120 + 45 * Math.sin(hrRad);
  const minX = 120 + 70 * Math.cos(minRad);
  const minY = 120 + 70 * Math.sin(minRad);

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal">
        <div className="activity-modal-header">
          <span className="activity-modal-title">🕰️ SLUMS Clock Drawing Test</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>

        <div className="activity-modal-body">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", marginBottom: "8px" }}>
            <p style={{ margin: 0, flex: 1 }}>Please set the clock hands to show <strong>10:00 (10 o'clock)</strong>.</p>
            <button
              className="modal-speak-btn"
              onClick={() => speakTaskText("Please set the clock hands to show ten o'clock.")}
              title="Read aloud"
              style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
            >
              🔊
            </button>
          </div>
          <p style={{ fontStyle: "italic", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Select a hand setting below, then click or drag on the clock face, or use the sliders to align the hands.
          </p>

          <div style={{ display: "flex", gap: "8px", margin: "10px 0" }}>
            <button
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: activeSetting === "hour" ? "var(--accent-primary)" : "var(--glass-border)",
                background: activeSetting === "hour" ? "rgba(99, 102, 241, 0.2)" : "rgba(255,255,255,0.02)",
                color: activeSetting === "hour" ? "#fff" : "var(--text-muted)",
                cursor: "pointer",
                fontWeight: "600"
              }}
              onClick={() => setActiveSetting("hour")}
            >
              Adjust Hour Hand
            </button>
            <button
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: activeSetting === "minute" ? "var(--accent-secondary)" : "var(--glass-border)",
                background: activeSetting === "minute" ? "rgba(168, 85, 247, 0.2)" : "rgba(255,255,255,0.02)",
                color: activeSetting === "minute" ? "#fff" : "var(--text-muted)",
                cursor: "pointer",
                fontWeight: "600"
              }}
              onClick={() => setActiveSetting("minute")}
            >
              Adjust Minute Hand
            </button>
          </div>

          <div style={{ position: "relative", width: "240px", height: "240px", userSelect: "none" }}>
            <svg
              ref={svgRef}
              width="240"
              height="240"
              style={{ cursor: "pointer", overflow: "visible" }}
              onMouseDown={handleSvgInteraction}
              onTouchStart={handleSvgInteraction}
              onTouchMove={handleTouchMove}
            >
              {/* Outer Ring */}
              <circle cx="120" cy="120" r="100" fill="rgba(0,0,0,0.4)" stroke="var(--text-main)" strokeWidth="4" />
              {/* Center Dot */}
              <circle cx="120" cy="120" r="6" fill="var(--accent-primary)" />

              {/* Clock Numbers */}
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => {
                const angle = (num * 30 - 90) * (Math.PI / 180);
                const nx = 120 + 82 * Math.cos(angle);
                const ny = 120 + 82 * Math.sin(angle);
                return (
                  <text
                    key={num}
                    x={nx}
                    y={ny + 5}
                    textAnchor="middle"
                    fill="var(--text-main)"
                    fontSize="14"
                    fontWeight="700"
                  >
                    {num}
                  </text>
                );
              })}

              {/* Hour Hand (Purple) */}
              <line x1="120" y1="120" x2={hrX} y2={hrY} stroke="#a855f7" strokeWidth="6" strokeLinecap="round" />

              {/* Minute Hand (Indigo) */}
              <line x1="120" y1="120" x2={minX} y2={minY} stroke="#6366f1" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>

          <div style={{ width: "100%", padding: "10px 0" }}>
            <span style={{ fontSize: "1.2rem", fontWeight: "700" }}>
              Time: {Math.floor(hour)}:{minute.toString().padStart(2, "0")}
            </span>
          </div>

          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", textAlign: "left" }}>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Hour Slider: {hour}</label>
              <input
                type="range"
                min="1"
                max="12"
                step="0.1"
                value={hour}
                style={{ width: "100%", accentColor: "#a855f7" }}
                onChange={(e) => setHour(parseFloat(parseFloat(e.target.value).toFixed(1)))}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Minute Slider: {minute}</label>
              <input
                type="range"
                min="0"
                max="59"
                step="1"
                value={minute}
                style={{ width: "100%", accentColor: "#6366f1" }}
                onChange={(e) => setMinute(parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="activity-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>Submit Clock</button>
        </div>
      </div>
    </div>
  );
}

function FAQModal({ onComplete, onClose }) {
  const FAQ_ACTIVITIES = [
    { id: "bills", text: "Writing checks, paying bills, balancing checkbook." },
    { id: "records", text: "Assembling tax records, business affairs, or papers." },
    { id: "shopping", text: "Shopping alone for clothes, household necessities, or groceries." },
    { id: "games", text: "Playing a game of skill, working on a hobby." },
    { id: "stove", text: "Heating water, making a cup of coffee, turning off stove." },
    { id: "meal_prep", text: "Preparing a balanced meal." },
    { id: "current_events", text: "Keeping track of current events." },
    { id: "media", text: "Paying attention to, understanding, or discussing TV, book, magazine." },
    { id: "appointments", text: "Remembering appointments, family occasions, holidays, medications." },
    { id: "travel", text: "Traveling out of neighborhood, driving, or using public transportation." }
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [scores, setScores] = useState({});

  const handleScoreSelect = (score) => {
    const actId = FAQ_ACTIVITIES[currentStep].id;
    setScores((prev) => ({ ...prev, [actId]: score }));

    if (currentStep < FAQ_ACTIVITIES.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (currentStep < FAQ_ACTIVITIES.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleSubmit = () => {
    let totalScore = 0;
    const detailsArr = [];

    FAQ_ACTIVITIES.forEach((act) => {
      const score = scores[act.id] !== undefined ? scores[act.id] : 0;
      totalScore += score;
      detailsArr.push(`${act.id}=${score}`);
    });

    const results = {
      score: totalScore,
      details: detailsArr.join(", ")
    };

    onComplete(results);
  };

  const isAllAnswered = FAQ_ACTIVITIES.every((act) => scores[act.id] !== undefined);
  const currentSelectedScore = scores[FAQ_ACTIVITIES[currentStep].id];

  return (
    <div className="activity-modal-overlay">
      <div className="activity-modal" style={{ maxWidth: "550px" }}>
        <div className="activity-modal-header">
          <span className="activity-modal-title">📋 Functional Activities Questionnaire (FAQ)</span>
          <button className="close-report-btn" onClick={onClose}>✕</button>
        </div>

        <div className="activity-modal-body" style={{ textAlign: "left", alignItems: "stretch" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            <span>Question {currentStep + 1} of 10</span>
            <span>Progress: {Math.round(((currentStep + 1) / 10) * 100)}%</span>
          </div>

          {/* Progress Bar */}
          <div style={{ height: "4px", background: "var(--glass-border)", borderRadius: "2px", margin: "8px 0 20px 0", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${((currentStep + 1) / 10) * 100}%`, background: "var(--accent-gradient)", transition: "width 0.3s ease" }}></div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "space-between", marginBottom: "16px" }}>
            <h4 style={{ fontSize: "1.1rem", margin: 0, lineHeight: "1.4", color: "var(--text-highlight)", flex: 1 }}>
              {FAQ_ACTIVITIES[currentStep].text}
            </h4>
            <button
              className="modal-speak-btn"
              onClick={() => speakTaskText(FAQ_ACTIVITIES[currentStep].text)}
              title="Read question aloud"
              style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", cursor: "pointer", fontSize: "1.1rem", padding: "6px 10px" }}
            >
              🔊
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { val: 0, label: "Independent (Normal)" },
              { val: 1, label: "Has difficulty but does task alone" },
              { val: 2, label: "Requires assistance" },
              { val: 3, label: "Dependent" }
            ].map((opt) => {
              const isSelected = currentSelectedScore === opt.val;
              return (
                <button
                  key={opt.val}
                  onClick={() => handleScoreSelect(opt.val)}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "12px",
                    border: "1px solid",
                    borderColor: isSelected ? "var(--accent-primary)" : "var(--glass-border)",
                    background: isSelected ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.02)",
                    color: isSelected ? "#fff" : "var(--text-main)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.95rem",
                    fontWeight: isSelected ? "700" : "500",
                    transition: "all 0.2s ease",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <span>{opt.label}</span>
                  {isSelected && <span style={{ color: "var(--accent-primary)" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="activity-modal-footer" style={{ justifyContent: "space-between" }}>
          <div>
            <button className="btn-secondary" onClick={handlePrev} disabled={currentStep === 0}>
              Previous
            </button>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {currentStep < FAQ_ACTIVITIES.length - 1 ? (
              <button className="btn-secondary" onClick={handleNext} disabled={currentSelectedScore === undefined}>
                Next
              </button>
            ) : (
              <button className="btn-primary" onClick={handleSubmit} disabled={!isAllAnswered}>
                Complete & Submit
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
